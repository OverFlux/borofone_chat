(() => {
    'use strict';

    const runtime = window.__BOROFONE_RUNTIME_CONFIG__ || {};
    const demoButton = document.getElementById('demo-login-button');
    const errorText = document.getElementById('demo-login-error');

    if (!demoButton || runtime.appEnv !== 'development') {
        return;
    }

    demoButton.hidden = false;

    demoButton.addEventListener('click', async () => {
        demoButton.disabled = true;
        demoButton.textContent = 'Готовим demo…';
        errorText.textContent = '';

        try {
            const response = await fetch('/auth/demo', {
                method: 'POST',
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Не удалось войти в demo');
            }

            window.location.href = runtime.routes?.main || '/main.html';
        } catch (error) {
            errorText.textContent = error.message === 'Failed to fetch'
                ? 'Не удалось подключиться. Проверьте, что локальная база запущена.'
                : error.message;
            demoButton.disabled = false;
            demoButton.textContent = 'Войти как demo';
        }
    });
})();
