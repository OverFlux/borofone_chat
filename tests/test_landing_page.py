from fastapi.testclient import TestClient

from app.main import app


def test_root_serves_borotalk_landing_without_redirect():
    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache"
    assert "Зашёл." in response.text
    assert 'href="/login.html"' in response.text


def test_landing_assets_and_existing_pages_remain_available():
    with TestClient(app) as client:
        landing_css = client.get("/styles/landing.css")
        landing_js = client.get("/js/landing.js")
        main_page = client.get("/main.html")
        login_page = client.get("/login.html")
        register_page = client.get("/register.html")

    assert landing_css.status_code == 200
    assert landing_js.status_code == 200
    assert main_page.status_code == 200
    assert login_page.status_code == 200
    assert register_page.status_code == 200


def test_landing_demo_script_has_no_network_or_media_calls():
    with TestClient(app) as client:
        script = client.get("/js/landing.js").text

    forbidden_calls = ("fetch(", "WebSocket(", "getUserMedia(", "mediaDevices.")
    assert not any(call in script for call in forbidden_calls)


def test_main_app_uses_standalone_nova_interface_without_legacy_ui():
    with TestClient(app) as client:
        main_page = client.get("/main.html")
        nova_css = client.get("/styles/nova-app.css")
        nova_js = client.get("/js/nova-main.js")

    assert main_page.status_code == 200
    assert nova_css.status_code == 200
    assert nova_js.status_code == 200
    assert "Разговор начинается" in main_page.text
    assert 'href="/styles/nova-app.css?v=22"' in main_page.text
    assert 'src="/js/nova-main.js?v=22"' in main_page.text
    assert 'id="messageList"' in main_page.text
    assert 'id="voiceRoomList"' in main_page.text
    assert 'class="server-rail"' in main_page.text
    assert 'class="chat-panel"' in main_page.text
    assert "styles/main.css" not in main_page.text
    assert "js/app/bootstrap.js" not in main_page.text
    assert "attachments.css" not in main_page.text
    assert "wordle" not in main_page.text.lower()
    assert "#b8f5d6" in nova_css.text.lower()
    assert "#242424" in nova_css.text.lower()
    assert "Микрофон" in main_page.text
    assert "Экран" in main_page.text
    assert 'id="audioInputSelect"' in main_page.text
    assert 'id="audioOutputSelect"' in main_page.text
    assert "setSinkId" in nova_js.text
    assert "iceRestart: true" in nova_js.text
    assert 'id="shareFullscreenButton"' in main_page.text
    assert 'id="sharePipButton"' in main_page.text
    assert "toggleSharePictureInPicture" in nova_js.text
    assert "state.shareZoom" in nova_js.text
    assert 'id="shareVolumeSlider"' in main_page.text
    assert 'id="shareAudioMuteButton"' in main_page.text
    assert 'systemAudio: "include"' in nova_js.text
    assert "screen-share-no-audio" in nova_js.text
    assert "attachScreenAudio" in nova_js.text
    assert "reconcileRemoteAudio" in nova_js.text
    assert "joinedParticipantId !== state.user.id" in nova_js.text
    assert 'id="participantVolumePopover"' in main_page.text
    assert '"contextmenu"' in nova_js.text
    assert "borotalk-participant-volumes" in nova_js.text
    assert "scrollMessagesToBottom" in nova_js.text
    assert 'id="messageLimit"' in main_page.text
    assert 'maxlength="2000"' in main_page.text
    assert "Достигнут лимит" in nova_js.text
    assert 'id="stagePresence"' in main_page.text
    assert "renderStagePresence" in nova_js.text
    assert "participant-card.muted" in nova_css.text
    assert "participant.deafened" in nova_js.text
    assert "toastKey" in nova_js.text
    assert "hydrateIcons" in nova_js.text
    assert 'id="ui-mic"' in main_page.text
    assert "🎙️" not in main_page.text
    assert "🎧" not in main_page.text
    assert "🖥️" not in main_page.text
    assert 'window.addEventListener("online"' in nova_js.text
    assert 'socket.send(JSON.stringify({ type: "ping" }))' in nova_js.text


def test_auth_pages_use_nova_auth_surface_without_legacy_scripts():
    with TestClient(app) as client:
        login_page = client.get("/login.html").text
        register_page = client.get("/register.html").text
        auth_css = client.get("/styles/nova-auth.css")
        auth_js = client.get("/js/nova-auth.js")

    assert auth_css.status_code == 200
    assert auth_js.status_code == 200
    for page in (login_page, register_page):
        assert "/styles/nova-auth.css?v=7" in page
        assert "/js/nova-auth.js?v=5" in page
        assert "styles/login.css" not in page
        assert "styles/register.css" not in page
        assert "js/config.js" not in page
        assert "js/tips.js" not in page
        assert 'name="email"' in page
        assert 'name="password"' in page
        assert 'autocomplete="username"' in page
        assert "/icons/borotalk-64.png?v=2" in page

    assert 'id="username" name="profile_nickname"' in register_page
    assert 'id="username" name="profile_nickname" type="text" autocomplete="off"' in register_page
