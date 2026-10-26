// Cifrado de la API BNC "Soluciones en Línea" (ESolutions).
// Portado 1:1 desde los scripts pre-request/test de la colección oficial de
// Postman del banco — no cambiar los parámetros de PBKDF2/AES sin volver a
// probar contra el ambiente real, cualquier desvío rompe el descifrado.
const CryptoJS = require('crypto-js');

const SALT_HEX = [0x49, 0x76, 0x61, 0x6e, 0x20, 0x4d, 0x65, 0x64, 0x76, 0x65, 0x64, 0x65, 0x76]
  .map(b => b.toString(16).padStart(2, '0')).join(''); // "Ivan Medvedev"

class DataCypher {
  constructor(encryptionKey) {
    const salt = CryptoJS.enc.Hex.parse(SALT_HEX);
    const keyAndIv = CryptoJS.PBKDF2(encryptionKey, salt, { keySize: 48 / 4, iterations: 1000, hasher: CryptoJS.algo.SHA1 });
    this.key = CryptoJS.lib.WordArray.create(keyAndIv.words.slice(0, 8), 32);
    this.iv = CryptoJS.lib.WordArray.create(keyAndIv.words.slice(8, 12), 16);
  }
  encryptAES(text) {
    const textWordArray = CryptoJS.enc.Utf16LE.parse(text);
    return CryptoJS.AES.encrypt(textWordArray, this.key, { iv: this.iv }).toString();
  }
  decryptAES(text) {
    return CryptoJS.AES.decrypt(text, this.key, { iv: this.iv }).toString(CryptoJS.enc.Utf16LE);
  }
  encryptSHA256(requestData) {
    return CryptoJS.SHA256(requestData.trim()).toString(CryptoJS.enc.Hex);
  }
}

// Arma el sobre {ClientGUID, Reference, Value, Validation, swTestOperation}
// que espera cada endpoint de BNC. `encryptionKey` es el MasterKey para el
// LogOn y la WorkingKey del día para todo lo demás.
function buildEnvelope(clientGUID, bodyObj, encryptionKey) {
  const jsonObjRequest = JSON.stringify(bodyObj);
  const cypher = new DataCypher(encryptionKey);
  return {
    ClientGUID: clientGUID,
    Reference: 'natan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    Value: cypher.encryptAES(jsonObjRequest),
    Validation: cypher.encryptSHA256(jsonObjRequest),
    swTestOperation: false,
  };
}

function decryptValue(encryptedValue, encryptionKey) {
  const cypher = new DataCypher(encryptionKey);
  const plain = cypher.decryptAES(encryptedValue);
  return JSON.parse(plain);
}

module.exports = { DataCypher, buildEnvelope, decryptValue };
