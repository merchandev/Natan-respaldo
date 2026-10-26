#!/usr/bin/env python3
"""Actualiza solo la app existente; reutiliza Traefik y su emisor ACME."""
import argparse
import copy
import datetime
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = 'natanelectronics.com'

def run(*args, env=None, quiet=False):
    result = subprocess.run(args, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # No imprimir salidas que puedan contener variables del contenedor.
        raise RuntimeError('Falló el comando: ' + shlex.join(args[:4]) + (' (salida omitida por privacidad)' if quiet else '\n' + result.stderr[-2000:]))
    return result.stdout

def inspect(container):
    return json.loads(run('docker', 'inspect', container, quiet=True))[0]

def env_map(container):
    return dict(item.split('=', 1) for item in container['Config'].get('Env', []) if '=' in item)

def flatten(value, prefix=''):
    result = {}
    for key, item in (value or {}).items():
        name = (prefix + '.' + key if prefix else key).lower()
        if isinstance(item, dict):
            result[name] = True
            result.update(flatten(item, name))
        else:
            result[name] = item
    return result

def cli_options(args):
    result = {}
    index = 0
    while index < len(args):
        item = args[index]
        if item.startswith('--'):
            item = item[2:]
            if '=' in item:
                key, value = item.split('=', 1)
            elif index + 1 < len(args) and not args[index + 1].startswith('--'):
                key, value = item, args[index + 1]
                index += 1
            else:
                key, value = item, True
            result[key.lower()] = value
        index += 1
    return result

def proxy_options(proxy):
    flags = cli_options(proxy.get('Args', []))
    configfile = flags.get('configfile') or env_map(proxy).get('TRAEFIK_CONFIGFILE')
    paths = [configfile] if configfile else ['/etc/traefik/traefik.yml', '/etc/traefik/traefik.yaml', '/etc/traefik/traefik.toml']
    config = {}
    for filename in paths:
        # Lee solamente la configuración estática; nunca el almacén ACME.
        read = subprocess.run(['docker', 'exec', proxy['Id'], 'cat', filename], text=True, capture_output=True)
        if read.returncode:
            continue
        try:
            if filename.endswith('.toml'):
                import tomllib
                config = flatten(tomllib.loads(read.stdout))
            elif filename.endswith('.json'):
                config = flatten(json.loads(read.stdout))
            else:
                import yaml
                config = flatten(yaml.safe_load(read.stdout))
        except ImportError as exc:
            raise RuntimeError('Para leer el archivo estático instala python3-yaml (o Python 3.11+ para TOML)') from exc
        except Exception as exc:
            raise RuntimeError('No se pudo interpretar el archivo estático del proxy; no se imprimió su contenido') from exc
        break
    config.update(flags)
    # Traefik acepta las mismas opciones mediante variables de entorno.
    for key, value in env_map(proxy).items():
        if key.startswith('TRAEFIK_'):
            config[key[8:].lower().replace('_', '.')] = value
    return config

def enabled(value):
    return value is True or str(value).lower() == 'true'

def select_entrypoint(config, preferred, port):
    key = 'entrypoints.' + preferred.lower() + '.address'
    if key in config:
        if str(config[key]).split('/')[0].endswith(':' + str(port)):
            return preferred
        raise RuntimeError('El entrypoint ' + preferred + ' no escucha en ' + str(port))
    candidates = [key.split('.')[1] for key, value in config.items() if re.fullmatch(r'entrypoints\.[^.]+\.address', key) and str(value).split('/')[0].endswith(':' + str(port))]
    if len(candidates) != 1:
        raise RuntimeError('No se pudo identificar el entrypoint del puerto ' + str(port) + '; comprobar la configuración de Traefik')
    return candidates[0]

def select_network(proxy, config, requested):
    networks = [name for name in proxy['NetworkSettings']['Networks'] if name not in ('host', 'none', 'bridge')]
    chosen = requested or config.get('providers.docker.network')
    if chosen:
        if chosen not in networks:
            raise RuntimeError('La red indicada no está conectada al proxy: ' + chosen)
        return chosen
    if len(networks) == 1:
        return networks[0]
    raise RuntimeError('Traefik tiene varias redes. Elegir con --traefik-network: ' + ', '.join(networks))

def resolver_check(proxy, config, preferred):
    names = sorted({key.split('.')[1] for key in config if key.startswith('certificatesresolvers.') and '.acme' in key})
    name = preferred if preferred.lower() in names else names[0] if len(names) == 1 else None
    if not name:
        raise RuntimeError('No se identificó un emisor ACME existente. No se modificó Traefik.')
    prefix = 'certificatesresolvers.' + name.lower() + '.acme'
    if not (config.get(prefix + '.httpchallenge.entrypoint') or enabled(config.get(prefix + '.tlschallenge')) or config.get(prefix + '.dnschallenge.provider')):
        raise RuntimeError('El emisor ACME no tiene un challenge configurado')
    if 'staging' in str(config.get(prefix + '.caserver', '')).lower():
        raise RuntimeError('El emisor ACME es de pruebas; no emitirá un certificado público válido')
    storage = str(config.get(prefix + '.storage', 'acme.json'))
    if not storage.startswith('/'):
        storage = str(PurePosixPath(proxy['Config'].get('WorkingDir') or '/') / storage)
    persistent = any(mount.get('RW', False) and (storage == mount['Destination'] or storage.startswith(mount['Destination'].rstrip('/') + '/')) for mount in proxy.get('Mounts', []))
    if not persistent:
        raise RuntimeError('El almacén ACME no está en un montaje persistente escribible; revisar Traefik antes de continuar')
    return name

def check_target(app):
    labels = app['Config'].get('Labels') or {}
    project = labels.get('com.docker.compose.project', '')
    if project not in ('natan', 'natan-respaldo', 'old-natan') or labels.get('com.docker.compose.service') != 'app':
        raise RuntimeError('El contenedor no pertenece al servicio app de natan/natan-respaldo/old-natan; no se tocará')
    if not app['State']['Running']:
        raise RuntimeError('La app de origen no está ejecutándose')
    if app.get('Mounts'):
        raise RuntimeError('La app tiene volúmenes no previstos; se requiere revisar antes de recrearla')
    return project

def conflicting_routes(containers, app_id):
    host = re.compile(r'(?<![\w.-])(?:www\.)?natanelectronics\.com(?![\w.-])')
    return [item['Name'].lstrip('/') for item in containers if item['Id'] != app_id and any(key.startswith('traefik.http.routers.') and key.endswith('.rule') and host.search(value) for key, value in (item['Config'].get('Labels') or {}).items())]

def preserve_runtime(config, app):
    service = config['services']['app']
    service.pop('build', None)
    service['container_name'] = app['Name'].lstrip('/')
    service['environment'] = env_map(app)
    service['environment']['PORT'] = '3000'
    bindings = app['HostConfig'].get('PortBindings') or {}
    if set(bindings) != {'3000/tcp'} or not bindings['3000/tcp']:
        raise RuntimeError('Los puertos de la app no coinciden con el despliegue esperado')
    service['ports'] = [{'target': 3000, 'published': binding['HostPort'], 'host_ip': binding['HostIp'] or '0.0.0.0', 'protocol': 'tcp'} for binding in bindings['3000/tcp']]
    config['networks'] = {}
    service['networks'] = {}
    for index, (name, settings) in enumerate(app['NetworkSettings']['Networks'].items()):
        alias = 'existing_' + str(index)
        config['networks'][alias] = {'external': True, 'name': name}
        service['networks'][alias] = {'aliases': [value for value in settings.get('Aliases') or [] if value != app['Id'][:12]]}
    return config

def write_private(filename, data):
    filename.write_text(json.dumps(data, indent=2) + '\n', encoding='utf8')
    filename.chmod(0o600)

def literal_compose(value):
    # Los valores de docker inspect y config ya están resueltos. Escapar '$'
    # para evitar otra interpolación al cargar el JSON como archivo Compose.
    if isinstance(value, str):
        return value.replace('$', '$$')
    if isinstance(value, list):
        return [literal_compose(item) for item in value]
    if isinstance(value, dict):
        return {key: literal_compose(item) for key, item in value.items()}
    return value

def verify_https(wait):
    deadline = time.monotonic() + wait
    while True:
        try:
            for host in (DOMAIN, 'www.' + DOMAIN):
                with urllib.request.urlopen('https://' + host + '/healthz', timeout=10) as response:
                    if json.load(response).get('service') != 'natan-vps':
                        raise ValueError('El dominio todavía apunta a otro backend')
                    if response.url != 'https://' + DOMAIN + '/healthz':
                        raise ValueError('Falta redirección al dominio principal')
            return True
        except Exception:
            if time.monotonic() >= deadline:
                return False
            print('Esperando certificado válido y enrutamiento HTTPS...', flush=True)
            time.sleep(10)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-container', default='natan-app-1')
    parser.add_argument('--traefik-container')
    parser.add_argument('--traefik-network')
    parser.add_argument('--http-entrypoint', default='web')
    parser.add_argument('--https-entrypoint', default='websecure')
    parser.add_argument('--cert-resolver', default='letsencrypt')
    parser.add_argument('--expected-ip', default='72.62.86.94')
    parser.add_argument('--tls-wait', type=int, default=180)
    parser.add_argument('--apply', action='store_true', help='Sin esta opción solo se comprueba y prepara')
    active_file = ROOT / '.deploy-private' / 'active.json'
    if active_file.exists():
        saved = json.loads(active_file.read_text(encoding='utf8'))
        parser.set_defaults(**{key: saved[key] for key in ('app_container', 'traefik_container', 'traefik_network', 'http_entrypoint', 'https_entrypoint', 'cert_resolver') if key in saved})
    args = parser.parse_args()
    os.umask(0o077)
    app = inspect(args.app_container)
    project = check_target(app)
    ids = run('docker', 'ps', '-q').split()
    containers = json.loads(run('docker', 'inspect', *ids, quiet=True))
    candidates = [item for item in containers if re.search(r'(^|/)traefik(?=[:@]|$)', item['Config']['Image'])]
    if args.traefik_container:
        candidates = [item for item in containers if args.traefik_container in (item['Name'].lstrip('/'), item['Id'], item['Id'][:12])]
    if len(candidates) != 1:
        raise RuntimeError('Indicar --traefik-container; candidatos: ' + ', '.join(item['Name'].lstrip('/') for item in candidates))
    proxy = candidates[0]
    config = proxy_options(proxy)
    if str(config.get('providers.docker')).lower() == 'false' or not any(key.startswith('providers.docker') and str(value).lower() != 'false' for key, value in config.items()):
        raise RuntimeError('No se pudo verificar el proveedor Docker del proxy')
    http = select_entrypoint(config, args.http_entrypoint, 80)
    https = select_entrypoint(config, args.https_entrypoint, 443)
    resolver = resolver_check(proxy, config, args.cert_resolver)
    network = select_network(proxy, config, args.traefik_network)
    run('docker', 'network', 'inspect', network, quiet=True)
    conflicts = conflicting_routes(containers, app['Id'])
    if conflicts:
        raise RuntimeError('Hay otra ruta Docker para este dominio: ' + ', '.join(conflicts) + '. Resolver esa asociación antes de continuar.')
    for host in (DOMAIN, 'www.' + DOMAIN):
        addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        if addresses != {args.expected_ip}:
            raise RuntimeError('DNS inesperado para ' + host + ': ' + ', '.join(addresses))
    print('Proyecto:', project, '| App:', args.app_container, '| Proxy:', proxy['Name'].lstrip('/'))
    print('Red:', network, '| Entrypoints:', http, https, '| Emisor ACME:', resolver)
    env = dict(os.environ, TRAEFIK_NETWORK=network, TRAEFIK_HTTP_ENTRYPOINT=http, TRAEFIK_HTTPS_ENTRYPOINT=https, TRAEFIK_CERT_RESOLVER=resolver)
    base = json.loads(run('docker', 'compose', '-f', 'compose.yaml', 'config', '--format', 'json', env=env, quiet=True))
    merged = json.loads(run('docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.https.yaml', 'config', '--format', 'json', env=env, quiet=True))
    base = preserve_runtime(base, app)
    base['name'] = project
    base['services']['app']['labels'] = {key: value for key, value in (app['Config'].get('Labels') or {}).items() if not key.startswith('com.docker.compose.')}
    updated = copy.deepcopy(base)
    # Quitar las rutas Traefik anteriores de ESTA app, conservando otras etiquetas.
    updated['services']['app']['labels'] = {key: value for key, value in base['services']['app']['labels'].items() if not key.startswith('traefik.')}
    # `compose config` reescapa dólares para que su salida pueda reutilizarse
    # como Compose. Aquí volvemos al valor real antes de guardar todo junto.
    updated['services']['app']['labels'].update({key: value.replace('$$', '$') for key, value in merged['services']['app']['labels'].items()})
    updated['networks']['natan_proxy'] = {'external': True, 'name': network}
    # No declarar dos veces una red ya conectada.
    for alias, settings in list(updated['networks'].items()):
        if alias != 'natan_proxy' and settings['name'] == network:
            del updated['networks'][alias]
            del updated['services']['app']['networks'][alias]
    updated['services']['app']['networks']['natan_proxy'] = {'aliases': ['natan-respaldo-web']}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = ROOT / '.deploy-private' / stamp
    backup.mkdir(parents=True, mode=0o700)
    write_private(backup / 'original-container.json', app)
    write_private(backup / 'other-containers.json', {item['Id']: item['State']['StartedAt'] for item in containers if item['Id'] != app['Id']})
    revision = run('git', 'rev-parse', '--short=12', 'HEAD').strip()
    new_image, old_image = 'natan-https-release:' + revision, 'natan-https-rollback:' + stamp.lower()
    base['services']['app']['image'] = old_image
    updated['services']['app']['image'] = new_image
    old_file, new_file = backup / 'rollback.json', backup / 'compose.https.json'
    write_private(old_file, literal_compose(base))
    write_private(new_file, literal_compose(updated))
    compose = ['docker', 'compose', '-p', project, '-f', str(new_file)]
    rollback = ['docker', 'compose', '-p', project, '-f', str(old_file), 'up', '-d', '--no-build', '--no-deps', '--wait', 'app']
    (backup / 'rollback.sh').write_text('#!/bin/sh\nset -eu\n' + shlex.join(rollback) + '\n', encoding='utf8')
    print('Copia privada y configuración:', backup)
    print('No se cambiarán los puertos publicados ni los datos de la aplicación.')
    if not args.apply:
        print('Comprobación completada. Repetir con --apply para construir y activar HTTPS.')
        return
    run('docker', 'tag', app['Image'], old_image)
    print('Construyendo la nueva imagen antes de tocar la app...', flush=True)
    run('docker', 'build', '-t', new_image, '.', quiet=True)
    # Detectar cambios concurrentes antes de recrear la aplicación.
    if inspect(args.app_container)['Id'] != app['Id']:
        raise RuntimeError('La app cambió durante la construcción. Volver a ejecutar la revisión.')
    print('Recreando únicamente ' + args.app_container + '...', flush=True)
    try:
        run(*compose, 'up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '90', 'app', quiet=True)
    except RuntimeError:
        print('La nueva app no quedó saludable; intentando recuperar la imagen anterior.', flush=True)
        run(*rollback, quiet=True)
        raise RuntimeError('Se recuperó la imagen anterior. Revisar el fallo antes de repetir.')
    for item in containers:
        if item['Id'] != app['Id'] and inspect(item['Id'])['State']['StartedAt'] != item['State']['StartedAt']:
            raise RuntimeError('Se detectó un reinicio concurrente de otro contenedor; revisar el VPS.')
    write_private(active_file, {'app_container': args.app_container, 'traefik_container': proxy['Name'].lstrip('/'), 'traefik_network': network, 'http_entrypoint': http, 'https_entrypoint': https, 'cert_resolver': resolver})
    print('Aplicación saludable. Traefik solicitará/renovará los certificados sin reiniciarse.')
    print('Reversión disponible: sh ' + shlex.quote(str(backup / 'rollback.sh')))
    if not verify_https(max(0, args.tls_wait)):
        raise RuntimeError('La app está activa pero HTTPS aún no está verificado. Consultar docker logs --since 10m ' + proxy['Name'].lstrip('/') + '. No se desactivó TLS ni se reinició el proxy.')
    print('HTTPS verificado con certificado válido en natanelectronics.com y www.natanelectronics.com.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print('DETENIDO:', str(error), file=sys.stderr)
        sys.exit(1)
