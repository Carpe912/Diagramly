"""Reproducible inventory of every reachable local legacy commit (no fetch)."""
import collections
import json
import pathlib
import subprocess
import sys

repo = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/Users/coopwire-test/coop-frontend/coopwire-drawio')
out = pathlib.Path(__file__).resolve().parents[1] / 'docs/research'
out.mkdir(parents=True, exist_ok=True)
def git(*args):
    return subprocess.check_output(['git', '-C', str(repo), '-c', 'core.quotePath=false', *args], text=True, errors='replace')
# --root and -m include the initial import and each merge-parent comparison.
log = git('log', '--all', '--reverse', '--date=short', '--format=@@%H%x09%ad%x09%P%x09%s', '--numstat', '--root', '-m')
commits = {}
touches = collections.Counter()
current = None
for line in log.splitlines():
    if line.startswith('@@'):
        sha, date, parents, subject = line[2:].split('\t', 3)
        current = commits.setdefault(sha, dict(sha=sha, date=date, parents=parents.split(), subject=subject, files={}))
    elif current and '\t' in line:
        added, deleted, path = line.split('\t', 2)
        # Merge paths may appear for both parents. Preserve each comparison.
        current['files'].setdefault(path, []).append(dict(added=added, deleted=deleted))
for c in commits.values():
    touches.update(c['files'].keys())
non_merge_touches = collections.Counter(p for c in commits.values() if len(c['parents']) < 2 for p in c['files'])
years = collections.Counter(c['date'][:4] for c in commits.values())
result = dict(scope='All commits reachable from local refs; no upstream baseline or network fetch. Merge diffs compare each parent.',
              head=git('rev-parse', 'HEAD').strip(), commits=list(commits.values()),
              summary=dict(total=len(commits), merges=sum(len(c['parents']) > 1 for c in commits.values()), years=dict(sorted(years.items())), mostChangedFiles=touches.most_common(50), nonMergeMostChangedFiles=non_merge_touches.most_common(50)))
(out / 'legacy-history.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
# Compact complete subject ledger is easier to review than the machine inventory.
(out / 'legacy-commits.md').write_text('# 旧项目完整提交索引\n\n含所有本地分支和标签可达提交；并非只统计 master，也不把 merge 当成独立业务功能。\n\n' + '\n'.join(f"- `{c['sha'][:8]}` {c['date']} {c['subject']}" for c in commits.values()) + '\n')
print(json.dumps({k: result['summary'][k] for k in ('total', 'merges', 'years')}, ensure_ascii=False, indent=2))
