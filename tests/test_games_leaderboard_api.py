import json

from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings


def test_legacy_leaderboard_endpoint_supports_list_and_submit(tmp_path):
    original_file = settings.leaderboard_file
    settings.__dict__['leaderboard_file'] = tmp_path / 'leaderboard.json'

    try:
        client = TestClient(app)

        initial = client.get('/games/api/leaderboard.php', params={'action': 'list', 'limit': 20})
        assert initial.status_code == 200
        assert initial.json()['leaderboard'] == []

        created = client.post(
            '/games/api/leaderboard.php',
            data={'action': 'submit', 'nickname': 'PlayerOne', 'score': '1337'},
        )
        assert created.status_code == 200
        body = created.json()
        assert body['success'] is True
        assert body['entry']['nickname'] == 'PlayerOne'
        assert body['entry']['score'] == 1337

        listed = client.get('/games/api/leaderboard.php', params={'action': 'list', 'limit': 20})
        assert listed.status_code == 200
        data = listed.json()
        assert len(data['leaderboard']) == 1
        assert data['leaderboard'][0]['nickname'] == 'PlayerOne'
        assert data['leaderboard'][0]['score'] == 1337

        stored = json.loads((tmp_path / 'leaderboard.json').read_text(encoding='utf-8'))
        assert stored[0]['nickname'] == 'PlayerOne'
        assert stored[0]['score'] == 1337
    finally:
        settings.__dict__['leaderboard_file'] = original_file


def test_legacy_leaderboard_endpoint_is_not_gzipped_for_godot_client(tmp_path):
    original_file = settings.leaderboard_file
    settings.__dict__['leaderboard_file'] = tmp_path / 'leaderboard.json'

    try:
        client = TestClient(app)

        response = client.get(
            '/games/api/leaderboard.php',
            params={'action': 'list', 'limit': 20},
            headers={'Accept-Encoding': 'gzip'},
        )

        assert response.status_code == 200
        assert response.headers.get('content-encoding') != 'gzip'
        assert response.json()['leaderboard'] == []
    finally:
        settings.__dict__['leaderboard_file'] = original_file
