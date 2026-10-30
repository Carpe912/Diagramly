#!/usr/bin/env python3
"""读取服务器私有配置，备份数据库并检查归档目录，保留最近十四天。"""
from pathlib import Path
from urllib.parse import urlparse, unquote
import datetime
import os
import subprocess

root = Path('/opt/diagramly')
config = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if '=' in line)
url = urlparse(config['DATABASE_URL'])
environment = os.environ.copy()
environment.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGUSER=unquote(url.username),
                   PGPASSWORD=unquote(url.password), PGDATABASE=url.path[1:])
directory = root / 'backups'
directory.mkdir(mode=0o700, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc)
archive = directory / ('diagramly-' + now.strftime('%Y%m%d-%H%M%S-%f') + '.dump')
temporary = archive.with_suffix('.partial')
try:
    # 不将连接串放入进程参数或日志。
    subprocess.run(['pg_dump', '-Fc', '-f', str(temporary)], env=environment, check=True, capture_output=True)
    temporary.chmod(0o600)
    subprocess.run(['pg_restore', '--list', str(temporary)], check=True, capture_output=True)
    temporary.rename(archive)
    for file in directory.glob('diagramly-*.dump'):
        if now.timestamp() - file.stat().st_mtime > 14 * 86400:
            file.unlink()
    print('Diagramly database archive verified')
except Exception:
    temporary.unlink(missing_ok=True)
    raise SystemExit('Diagramly database backup failed; existing archives retained')
