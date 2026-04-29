/**
 * Generate a shared self-signed SSL certificate for both Vite and backend.
 * Run once: node server/ssl/generate.js
 * Both servers read from the same cert files.
 */
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const sslDir = __dirname;
const keyPath = path.join(sslDir, 'key.pem');
const certPath = path.join(sslDir, 'cert.pem');

// Skip if already exists
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('[SSL] Certificate files already exist, skipping generation.');
  process.exit(0);
}

console.log('[SSL] Generating shared self-signed certificate...');

const pki = forge.pki;
const keys = pki.rsa.generateKeyPair(2048);
const cert = pki.createCertificate();

cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { name: 'commonName', value: 'PsyApp Dev Server' },
  { name: 'organizationName', value: 'PsyApp' },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);

// Add SAN (Subject Alternative Names) for IP and localhost
cert.setExtensions([
  { name: 'subjectAltName', altNames: [
    { type: 2, value: 'localhost' },       // DNS
    { type: 7, ip: '127.0.0.1' },         // IP
    { type: 7, ip: '10.1.156.76' },       // LAN IP
  ]},
  { name: 'basicConstraints', cA: true },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

fs.writeFileSync(keyPath, pki.privateKeyToPem(keys.privateKey));
fs.writeFileSync(certPath, pki.certificateToPem(cert));

console.log('[SSL] Certificate generated:');
console.log(`  Key:  ${keyPath}`);
console.log(`  Cert: ${certPath}`);
