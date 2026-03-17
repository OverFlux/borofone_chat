import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.settings import settings

router = APIRouter(tags=['Games'])

_MAX_LIMIT = 100
_MAX_NICKNAME_LENGTH = 24
_MAX_ENTRIES = 1000


def _ensure_storage_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text('[]\n', encoding='utf-8')


def _read_entries() -> list[dict[str, Any]]:
    path = settings.leaderboard_file
    _ensure_storage_file(path)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        nickname = str(item.get('nickname') or item.get('player_name') or '').strip()
        if not nickname:
            continue
        try:
            score = int(item.get('score', 0))
        except (TypeError, ValueError):
            continue
        normalized.append(
            {
                'nickname': nickname[:_MAX_NICKNAME_LENGTH],
                'score': score,
                'created_at': str(item.get('created_at') or ''),
                '_index': index,
            }
        )
    return normalized


def _write_entries(entries: list[dict[str, Any]]) -> None:
    payload = [
        {
            'nickname': entry['nickname'],
            'score': entry['score'],
            'created_at': entry['created_at'],
        }
        for entry in entries[:_MAX_ENTRIES]
    ]
    settings.leaderboard_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


def _sorted_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(entries, key=lambda item: (-item['score'], item['created_at'], item['_index']))


async def _request_params(request: Request) -> dict[str, Any]:
    params: dict[str, Any] = {}
    params.update(request.query_params)

    content_type = request.headers.get('content-type', '').lower()
    if 'application/json' in content_type:
        body = await request.json()
        if isinstance(body, dict):
            params.update(body)
    elif 'application/x-www-form-urlencoded' in content_type or 'multipart/form-data' in content_type:
        form = await request.form()
        params.update(form)

    return params


def _serialize_entries(entries: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    rows = []
    for position, entry in enumerate(_sorted_entries(entries)[:limit], start=1):
        rows.append(
            {
                'rank': position,
                'nickname': entry['nickname'],
                'player_name': entry['nickname'],
                'score': entry['score'],
                'created_at': entry['created_at'],
            }
        )
    return rows


@router.get('/games/api/leaderboard.php')
@router.post('/games/api/leaderboard.php')
async def leaderboard_compat(
    request: Request,
    action: str = Query('list'),
    limit: int = Query(20, ge=1, le=_MAX_LIMIT),
):
    params = await _request_params(request)
    resolved_action = str(params.get('action') or action or 'list').strip().lower()

    if resolved_action == 'list':
        entries = _serialize_entries(_read_entries(), limit=limit)
        return {
            'success': True,
            'action': 'list',
            'count': len(entries),
            'leaderboard': entries,
            'entries': entries,
            'data': entries,
        }

    if resolved_action in {'submit', 'save', 'add'}:
        raw_nickname = (
            params.get('nickname')
            or params.get('player_name')
            or params.get('name')
            or params.get('username')
            or ''
        )
        nickname = str(raw_nickname).strip()[:_MAX_NICKNAME_LENGTH]
        if not nickname:
            raise HTTPException(status_code=422, detail='nickname is required')

        raw_score = params.get('score') or params.get('points') or params.get('value')
        try:
            score = int(raw_score)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail='score must be an integer') from None

        entries = _read_entries()
        entry = {
            'nickname': nickname,
            'score': score,
            'created_at': datetime.now(timezone.utc).isoformat(),
            '_index': len(entries),
        }
        entries.append(entry)
        sorted_entries = _sorted_entries(entries)[:_MAX_ENTRIES]
        _write_entries(sorted_entries)

        top_entries = _serialize_entries(sorted_entries, limit=limit)
        rank = next((item['rank'] for item in top_entries if item['nickname'] == nickname and item['score'] == score), None)
        if rank is None:
            all_rows = _serialize_entries(sorted_entries, limit=len(sorted_entries))
            rank = next((item['rank'] for item in all_rows if item['nickname'] == nickname and item['score'] == score), len(sorted_entries))

        return {
            'success': True,
            'action': 'submit',
            'entry': {
                'nickname': nickname,
                'player_name': nickname,
                'score': score,
                'rank': rank,
            },
            'leaderboard': top_entries,
        }

    raise HTTPException(status_code=400, detail=f'unsupported action: {resolved_action}')
