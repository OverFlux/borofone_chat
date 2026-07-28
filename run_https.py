#!/usr/bin/env python3
"""
HTTPS Server Runner for Borofone Chat.
"""

import argparse
import os
import sys
import tempfile

import uvicorn

from app.settings import settings


def convert_pfx_to_pem(pfx_path: str, password: str) -> tuple[str, str]:
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.serialization import pkcs12
    except ImportError:
        print('Error: cryptography library required for PFX support')
        print('Install with: pip install cryptography')
        sys.exit(1)

    with open(pfx_path, 'rb') as file_handle:
        pfx_data = file_handle.read()

    private_key, certificate, _ = pkcs12.load_key_and_certificates(
        pfx_data,
        password.encode(),
    )

    cert_file = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)
    key_file = tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False)

    cert_pem = certificate.public_bytes(serialization.Encoding.PEM)
    cert_file.write(cert_pem.decode())
    cert_file.close()

    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    key_file.write(key_pem.decode())
    key_file.close()

    return cert_file.name, key_file.name


def get_public_url(host: str, port: int) -> str:
    if settings.public_base_url:
        return settings.public_base_url.rstrip('/') + '/'
    if settings.radmin_ip:
        return f'https://{settings.radmin_ip}:{port}/'
    return f'https://{host}:{port}/'


def main():
    parser = argparse.ArgumentParser(description='Run Borofone Chat with HTTPS')
    parser.add_argument('--host', default=settings.ssl_host, help='Host to bind to')
    parser.add_argument('--port', default=settings.ssl_port, type=int, help='Port to bind to')
    parser.add_argument('--cert', default=settings.ssl_cert_path, help='Path to SSL certificate file')
    parser.add_argument('--key', default=settings.ssl_key_path, help='Path to SSL private key file')
    parser.add_argument('--pfx', default=None, help='Path to PFX file (alternative to cert/key)')
    parser.add_argument(
        '--pfx-password',
        default=settings.ssl_pfx_password,
        help='Password for PFX file',
    )

    args = parser.parse_args()

    cert_file = args.cert
    key_file = args.key
    temp_files: list[str] = []

    if args.pfx:
        if not os.path.exists(args.pfx):
            print(f'Error: PFX file not found: {args.pfx}')
            sys.exit(1)
        print(f'Converting PFX to PEM: {args.pfx}')
        cert_file, key_file = convert_pfx_to_pem(args.pfx, args.pfx_password)
        temp_files = [cert_file, key_file]
    else:
        default_pfx_path = settings.ssl_pfx_path
        if not os.path.exists(args.cert) or not os.path.exists(args.key):
            if os.path.exists(default_pfx_path):
                print(f'PEM files not found, using PFX: {default_pfx_path}')
                cert_file, key_file = convert_pfx_to_pem(default_pfx_path, args.pfx_password)
                temp_files = [cert_file, key_file]
            else:
                if not os.path.exists(args.cert):
                    print(f'Error: Certificate file not found: {args.cert}')
                if not os.path.exists(args.key):
                    print(f'Error: Private key file not found: {args.key}')
                print('\nTo generate SSL certificates, run:')
                print('  PowerShell (as Admin): .\\scripts\\generate_ssl.ps1')
                sys.exit(1)

    public_url = get_public_url(args.host, args.port)

    print('=' * 50)
    print('Borofone Chat - HTTPS Server')
    print('=' * 50)
    print(f'Host: {args.host}')
    print(f'Port: {args.port}')
    print(f'Certificate: {cert_file}')
    print(f'Private Key: {key_file}')
    print(f'Public URL: {public_url}')
    print('=' * 50)

    try:
        uvicorn.run(
            'app.main:app',
            host=args.host,
            port=args.port,
            ssl_certfile=cert_file,
            ssl_keyfile=key_file,
            reload=False,
            access_log=True,
            limit_concurrency=100,
            limit_max_requests=1000,
            timeout_keep_alive=30,
        )
    finally:
        for temp_file in temp_files:
            try:
                os.unlink(temp_file)
            except OSError:
                pass


if __name__ == '__main__':
    main()
