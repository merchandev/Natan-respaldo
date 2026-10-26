import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

from enable_https import check_target, cli_options, conflicting_routes, flatten, literal_compose, preserve_runtime, resolver_check, select_entrypoint, select_network

ROOT = Path(__file__).resolve().parent.parent

def app_fixture():
    return {
        'Id': 'a' * 64, 'Name': '/natan-app-1', 'Image': 'sha256:old',
        'Config': {'Env': ['PORT=3000', 'SUPABASE_SERVICE_ROLE_KEY=test-$value-${literal}'], 'Labels': {'com.docker.compose.project': 'natan', 'com.docker.compose.service': 'app', 'traefik.enable': 'false'}},
        'State': {'Running': True}, 'Mounts': [],
        'HostConfig': {'PortBindings': {'3000/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '18091'}]}},
        'NetworkSettings': {'Networks': {'natan_default': {'Aliases': ['natan-app-1', 'app']}}}
    }

class HttpsTests(unittest.TestCase):
    def test_select_existing_network_and_reject_ambiguity(self):
        proxy = {'NetworkSettings': {'Networks': {'real-proxy-net': {}}}}
        self.assertEqual(select_network(proxy, {}, None), 'real-proxy-net')
        with self.assertRaises(RuntimeError):
            select_network(proxy, {}, 'traefik-net')
        proxy['NetworkSettings']['Networks']['other-net'] = {}
        with self.assertRaises(RuntimeError):
            select_network(proxy, {}, None)
        self.assertEqual(select_network(proxy, {'providers.docker.network': 'real-proxy-net'}, None), 'real-proxy-net')

    def test_proxy_configuration_and_acme_persistence(self):
        config = cli_options(['--providers.docker=true', '--entrypoints.web.address=:80', '--entrypoints.websecure.address', ':443', '--certificatesresolvers.letsencrypt.acme.tlschallenge=true', '--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json'])
        proxy = {'Config': {}, 'Mounts': [{'Destination': '/letsencrypt', 'RW': True}]}
        self.assertEqual(select_entrypoint(config, 'web', 80), 'web')
        self.assertEqual(select_entrypoint(config, 'https', 443), 'websecure')
        self.assertEqual(resolver_check(proxy, config, 'letsencrypt'), 'letsencrypt')
        with self.assertRaises(RuntimeError):
            resolver_check({'Config': {}, 'Mounts': []}, config, 'letsencrypt')
        config['certificatesresolvers.letsencrypt.acme.caserver'] = 'https://acme-staging-v02.api.letsencrypt.org/directory'
        with self.assertRaises(RuntimeError):
            resolver_check(proxy, config, 'letsencrypt')
        self.assertEqual(flatten({'entryPoints': {'websecure': {'address': ':443'}}})['entrypoints.websecure.address'], ':443')

    def test_only_intended_project_can_be_recreated(self):
        app = app_fixture()
        self.assertEqual(check_target(app), 'natan')
        app['Config']['Labels']['com.docker.compose.project'] = 'natan-electronics'
        with self.assertRaises(RuntimeError):
            check_target(app)
        app = app_fixture()
        app['Mounts'] = [{'Destination': '/data'}]
        with self.assertRaises(RuntimeError):
            check_target(app)

    def test_preserves_credentials_ports_name_and_existing_network(self):
        config = {'services': {'app': {'build': {'context': '.'}, 'environment': {'SUPABASE_SERVICE_ROLE_KEY': ''}}}}
        result = preserve_runtime(config, app_fixture())
        app = result['services']['app']
        self.assertNotIn('build', app)
        self.assertEqual(app['container_name'], 'natan-app-1')
        self.assertEqual(app['environment']['SUPABASE_SERVICE_ROLE_KEY'], 'test-$value-${literal}')
        self.assertEqual(app['ports'][0]['published'], '18091')
        self.assertEqual(result['networks']['existing_0'], {'external': True, 'name': 'natan_default'})
        self.assertNotIn('ipv4_address', app['networks']['existing_0'])

    def test_conflicts_are_limited_to_exact_domain(self):
        other = copy.deepcopy(app_fixture())
        other['Id'] = 'other'
        other['Name'] = '/other-project'
        other['Config']['Labels']['traefik.http.routers.other.rule'] = 'Host(`bnc-webhook.natanelectronics.com`)'
        self.assertEqual(conflicting_routes([other], 'app'), [])
        other['Config']['Labels']['traefik.http.routers.other.rule'] = 'Host(`www.natanelectronics.com`)'
        self.assertEqual(conflicting_routes([other], 'app'), ['other-project'])

    def test_compose_https_and_literal_credentials_roundtrip(self):
        env = dict(os.environ, TRAEFIK_NETWORK='real-proxy-net')
        command = ['docker', 'compose', '-f', 'compose.yaml', '-f', 'compose.https.yaml', 'config', '--format', 'json']
        merged = json.loads(subprocess.check_output(command, cwd=ROOT, env=env, text=True))
        labels = {key: value.replace('$$', '$') for key, value in merged['services']['app']['labels'].items()}
        self.assertEqual(labels['traefik.enable'], 'true')
        self.assertEqual(labels['traefik.docker.network'], 'real-proxy-net')
        self.assertEqual(labels['traefik.http.routers.natan-respaldo-https.tls.certresolver'], 'letsencrypt')
        self.assertEqual(labels['traefik.http.services.natan-respaldo-web.loadbalancer.server.port'], '3000')
        self.assertEqual(labels['traefik.http.middlewares.natan-respaldo-canonical.redirectregex.replacement'], 'https://natanelectronics.com/${1}')
        self.assertTrue(merged['networks']['proxy']['external'])
        private_value = 'test-$value-${literal}'
        minimal = {'services': {'app': {'image': 'node:24-alpine', 'environment': {'TEST_SECRET': private_value}, 'labels': labels}}}
        fd, name = tempfile.mkstemp(suffix='.json')
        project = 'natan-config-test-' + uuid.uuid4().hex[:8]
        compose = ['docker', 'compose', '-p', project, '-f', name]
        try:
            with os.fdopen(fd, 'w', encoding='utf8') as stream:
                json.dump(literal_compose(minimal), stream)
            created = subprocess.run(compose + ['create', 'app'], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(created.returncode, 0, created.stderr)
            container = subprocess.check_output(compose + ['ps', '-aq', 'app'], text=True).strip()
            actual = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]['Config']
            self.assertIn('TEST_SECRET=' + private_value, actual['Env'])
            self.assertEqual({key: value for key, value in actual['Labels'].items() if key.startswith('traefik.')}, labels)
        finally:
            subprocess.run(compose + ['down'], capture_output=True, text=True)
            os.unlink(name)

if __name__ == '__main__':
    unittest.main()
