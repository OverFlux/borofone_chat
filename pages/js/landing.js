(() => {
    'use strict';

    const root = document.documentElement;
    const themeToggle = document.querySelector('.theme-toggle');
    const themeStorageKey = 'borotalk-theme';

    const storedTheme = localStorage.getItem(themeStorageKey);
    const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const initialTheme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : preferredTheme;

    function setTheme(theme, persist = false) {
        root.dataset.theme = theme;
        themeToggle.setAttribute(
            'aria-label',
            theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
        );
        document.querySelector('meta[name="theme-color"]').setAttribute(
            'content',
            theme === 'dark' ? '#242424' : '#f6f5f2',
        );
        if (persist) {
            localStorage.setItem(themeStorageKey, theme);
        }
    }

    setTheme(initialTheme);

    themeToggle.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
    });

    const channelData = {
        kitchen: {
            title: 'Кухня',
            status: 'Можно подключаться',
            participants: [
                ['Е', 'Егор', 'avatar-mint', 'speaking'],
                ['М', 'Миша', 'avatar-purple', 'online'],
                ['А', 'Аня', 'avatar-peach', 'muted'],
                ['К', 'Костя', 'avatar-blue', 'online'],
            ],
            messages: [
                ['М', 'Миша', 'avatar-purple', 'Кто в голос?', '19:42'],
                ['Е', 'Егор', 'avatar-mint', 'Заходи, покажу экран', '19:43'],
                ['А', 'Аня', 'avatar-peach', 'BORO', '19:44', true],
            ],
        },
        night: {
            title: 'Ночной разговор',
            status: 'Тихий режим',
            participants: [
                ['М', 'Миша', 'avatar-purple', 'speaking'],
                ['В', 'Влад', 'avatar-blue', 'online'],
            ],
            messages: [
                ['В', 'Влад', 'avatar-blue', 'Я ещё не сплю', '00:18'],
                ['М', 'Миша', 'avatar-purple', 'Тогда заходи', '00:19'],
            ],
        },
        focus: {
            title: 'Не отвлекать',
            status: 'Один участник',
            participants: [
                ['А', 'Аня', 'avatar-peach', 'muted'],
            ],
            messages: [
                ['А', 'Аня', 'avatar-peach', 'Вернусь через пять минут', '18:06'],
            ],
        },
    };

    const participantGrid = document.getElementById('participant-grid');
    const chatMessages = document.getElementById('chat-messages');
    const channelTitle = document.getElementById('demo-channel-title');
    const channelStatus = document.getElementById('demo-status');

    function participantMarkup([initial, name, avatarClass, state]) {
        const stateMarkup = state === 'speaking'
            ? '<span class="sound-wave" aria-label="говорит"><i></i><i></i><i></i></span>'
            : `<span class="participant-state${state === 'muted' ? ' muted' : ''}" aria-hidden="true">${state === 'muted' ? '×' : '●'}</span>`;

        return `
            <article class="participant${state === 'speaking' ? ' participant-speaking' : ''}">
                <span class="participant-avatar ${avatarClass}">${initial}</span>
                ${stateMarkup}
                <strong>${name}</strong>
            </article>
        `;
    }

    function messageMarkup([initial, name, avatarClass, body, time, isEmoji = false]) {
        const messageBody = isEmoji ? `<span class="custom-emoji">${body}</span>` : body;
        return `
            <div class="chat-message">
                <span class="chat-avatar ${avatarClass}">${initial}</span>
                <p><strong>${name} <time>${time}</time></strong>${messageBody}</p>
            </div>
        `;
    }

    document.querySelectorAll('.channel-button').forEach((button) => {
        button.addEventListener('click', () => {
            const channel = channelData[button.dataset.channel];
            if (!channel) return;

            document.querySelectorAll('.channel-button').forEach((item) => {
                const isActive = item === button;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-pressed', String(isActive));
            });

            channelTitle.textContent = channel.title;
            channelStatus.textContent = channel.status;
            participantGrid.innerHTML = channel.participants.map(participantMarkup).join('');
            chatMessages.innerHTML = channel.messages.map(messageMarkup).join('');
        });
    });

    const voiceStage = document.querySelector('.voice-stage');
    const muteButton = document.getElementById('mute-button');
    const shareButton = document.getElementById('share-button');
    const connectButton = document.getElementById('connect-button');
    const screenCard = document.getElementById('screen-card');

    muteButton.addEventListener('click', () => {
        const pressed = muteButton.getAttribute('aria-pressed') === 'true';
        muteButton.setAttribute('aria-pressed', String(!pressed));
        muteButton.querySelector('.control-label').textContent = pressed ? 'Микрофон' : 'Выключен';
    });

    shareButton.addEventListener('click', () => {
        const pressed = shareButton.getAttribute('aria-pressed') === 'true';
        shareButton.setAttribute('aria-pressed', String(!pressed));
        voiceStage.classList.toggle('is-sharing', !pressed);
        screenCard.setAttribute('aria-hidden', String(pressed));
        shareButton.querySelector('.control-label').textContent = pressed ? 'Экран' : 'В эфире';
    });

    connectButton.addEventListener('click', () => {
        const pressed = connectButton.getAttribute('aria-pressed') === 'true';
        connectButton.setAttribute('aria-pressed', String(!pressed));
        connectButton.textContent = pressed ? 'Подключиться' : 'Отключиться';
        channelStatus.textContent = pressed ? 'Можно подключаться' : 'Вы в канале';
    });

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealItems = document.querySelectorAll('.reveal');

    if (reducedMotion || !('IntersectionObserver' in window)) {
        revealItems.forEach((item) => item.classList.add('is-visible'));
    } else {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        revealItems.forEach((item) => observer.observe(item));
    }
})();
