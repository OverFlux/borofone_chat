// ==========================================
// SCROLL MANAGER - Унифицированное управление скроллом
// ==========================================

/**
 * ScrollManager - управляет автоматическим скроллом в чате
 * Обеспечивает предсказуемое поведение во всех сценариях:
 * - Первоначальная загрузка страницы
 * - Переключение между комнатами
 * - Получение новых сообщений от других пользователей
 * - Получение новых вложений (изображения, файлы, голосовые)
 * - Отправка собственных сообщений
 */

const ScrollManager = (function() {
    // Конфигурация
    const CONFIG = {
        // Расстояние от низа в пикселях, которое считается "у дна"
        BOTTOM_THRESHOLD: 100,
        // Задержка перед проверкой скролла после добавления сообщения
        SCROLL_CHECK_DELAY: 50,
        // Задержка перед скроллом после загрузки изображений
        IMAGE_LOAD_DELAY: 100,
    };

    // Состояние
    let state = {
        // Пользователь в данный момент у дна (скролл)
        isAtBottom: true,
        // Идёт ли в данный момент процесс скролла
        isScrolling: false,
        // Сколько непрочитанных сообщений (когда пользователь не у дна)
        unreadCount: 0,
        // Был ли пользователь у дна до получения новых сообщений
        wasAtBottom: true,
        // ID таймера для отложенного скролла
        scrollTimer: null,
        // Инициализирован ли listeners
        initialized: false,
    };

    // DOM элементы
    let elements = {
        container: null,
        list: null,
        indicator: null,
        button: null,
        buttonText: null,
    };

    // ==========================================
    // Внутренние функции
    // ==========================================

    /**
     * Проверяет, находится ли пользователь у дна контейнера
     */
    function checkIsAtBottom() {
        if (!elements.container) return true;
        
        const { scrollTop, scrollHeight, clientHeight } = elements.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        
        return distanceFromBottom <= CONFIG.BOTTOM_THRESHOLD;
    }

    /**
     * Выполняет скролл к низу контейнера
     */
    function doScrollToBottom(immediate = false) {
        if (!elements.container) return;
        
        state.isScrolling = true;
        
        if (immediate) {
            elements.container.scrollTop = elements.container.scrollHeight;
            state.isScrolling = false;
            state.isAtBottom = true;
            return;
        }
        
        // Плавный скролл с использованием requestAnimationFrame
        requestAnimationFrame(() => {
            elements.container.scrollTo({
                top: elements.container.scrollHeight,
                behavior: 'smooth'
            });
            
            // После скролла обновляем состояние
            setTimeout(() => {
                state.isScrolling = false;
                state.isAtBottom = checkIsAtBottom();
                
                // Если удалось прокрутить к низу - сбрасываем счётчик
                if (state.isAtBottom) {
                    hideUnreadIndicator();
                }
            }, 300);
        });
    }

    /**
     * Скролл с ожиданием загрузки изображений
     */
    function scrollWithImages(waitForImages = true) {
        if (!elements.list) {
            doScrollToBottom();
            return;
        }

        if (!waitForImages) {
            doScrollToBottom();
            return;
        }

        // Находим все незагруженные изображения
        const images = elements.list.querySelectorAll('img:not([data-loaded])');
        
        if (images.length === 0) {
            doScrollToBottom();
            return;
        }

        // Подсчитываем ожидающие загрузки
        let pendingCount = images.length;

        const checkComplete = () => {
            pendingCount--;
            if (pendingCount <= 0) {
                // Даём небольшую задержку для рендеринга
                setTimeout(() => doScrollToBottom(), CONFIG.IMAGE_LOAD_DELAY);
            }
        };

        images.forEach(img => {
            // Если изображение уже загружено (из кэша)
            if (img.complete) {
                img.dataset.loaded = 'true';
                checkComplete();
                return;
            }

            // Ждём загрузки
            img.onload = () => {
                img.dataset.loaded = 'true';
                checkComplete();
            };

            img.onerror = () => {
                img.dataset.loaded = 'true';
                checkComplete();
            };
        });

        // Fallback: скроллим через небольшую задержку даже если изображения не загрузятся
        setTimeout(() => doScrollToBottom(), 500);
    }

    /**
     * Показывает индикатор непрочитанных сообщений
     */
    function showUnreadIndicator() {
        // Показываем кнопку
        if (elements.button) {
            if (state.unreadCount > 0) {
                // Обновляем текст - только цифра
                if (elements.buttonText) {
                    elements.buttonText.textContent = state.unreadCount;
                }
                elements.button.classList.add('visible');
            }
        }
        
        // Также показываем индикатор если есть
        if (elements.indicator) {
            if (state.unreadCount > 0) {
                elements.indicator.textContent = `${state.unreadCount} нов${state.unreadCount === 1 ? 'ое' : state.unreadCount < 5 ? 'ых' : 'их'} сообщ${state.unreadCount === 1 ? 'ие' : 'ий'}`;
                elements.indicator.classList.add('visible');
            }
        }
    }

    /**
     * Скрывает индикатор непрочитанных сообщений
     */
    function hideUnreadIndicator() {
        // Скрываем кнопку
        if (elements.button) {
            elements.button.classList.remove('visible');
        }
        
        // Скрываем индикатор
        if (elements.indicator) {
            elements.indicator.classList.remove('visible');
        }
        
        state.unreadCount = 0;
    }

    /**
     * Обработчик события скролла
     */
    function handleScroll() {
        const wasAtBottom = state.isAtBottom;
        state.isAtBottom = checkIsAtBottom();
        
        // Если пользователь прокрутил к низу - скрываем индикатор
        if (state.isAtBottom) {
            hideUnreadIndicator();
        }
    }

    /**
     * Обработчик прокрутки (с задержкой)
     */
    let scrollTimeout = null;
    function handleScrollDebounced() {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(handleScroll, 100);
    }

    // ==========================================
    // Публичный API
    // ==========================================

    /**
     * Инициализация менеджера скролла
     */
    function init(containerId, listId, indicatorId) {
        elements.container = document.getElementById(containerId);
        elements.list = document.getElementById(listId);
        elements.indicator = document.getElementById(indicatorId);
        elements.button = document.getElementById('scrollToBottom');
        elements.buttonText = document.getElementById('scrollToBottomText');

        if (!elements.container) {
            console.error('[ScrollManager] Container not found:', containerId);
            return;
        }

        // Устанавливаем начальное состояние
        state.isAtBottom = checkIsAtBottom();
        
        // Добавляем обработчики событий
        if (!state.initialized) {
            elements.container.addEventListener('scroll', handleScrollDebounced, { passive: true });
            
            // Также отслеживаем resize
            window.addEventListener('resize', handleScrollDebounced, { passive: true });
            
            state.initialized = true;
        }
    }

    /**
     * Скролл при первоначальной загрузке страницы
     * Всегда скроллит к низу, ожидая загрузки изображений
     */
    function scrollOnPageLoad() {
        state.isAtBottom = true;
        scrollWithImages(true);
    }

    /**
     * Скролл при переключении комнат
     * Всегда скроллит к низу
     */
    function scrollOnRoomChange() {
        state.isAtBottom = true;
        state.unreadCount = 0;
        hideUnreadIndicator();
        
        // Небольшая задержка чтобы контент успел отрисоваться
        setTimeout(() => {
            scrollWithImages(true);
        }, CONFIG.SCROLL_CHECK_DELAY);
    }

    /**
     * Скролл при получении нового сообщения
     * @param {Object} message - Объект сообщения
     * @param {boolean} isOwnMessage - Является ли сообщение своим
     */
    function scrollOnNewMessage(message, isOwnMessage = false) {
        // Если это своё сообщение - всегда скроллим к низу
        if (isOwnMessage) {
            scrollWithImages(true);
            return;
        }

        // Если пользователь у дна - скроллим к новому сообщению
        if (state.isAtBottom) {
            scrollWithImages(true);
        } else {
            // Пользователь прокрутил вверх - показываем индикатор
            state.unreadCount++;
            showUnreadIndicator();
        }
    }

    /**
     * Скролл при получении нового вложения
     * @param {Object} message - Объект сообщения с вложением
     * @param {boolean} isOwnMessage - Является ли сообщение своим
     */
    function scrollOnNewAttachment(message, isOwnMessage = false) {
        // Для вложений логика та же что и для обычных сообщений
        // Но с ожиданием загрузки изображений
        if (isOwnMessage) {
            scrollWithImages(true);
            return;
        }

        if (state.isAtBottom) {
            scrollWithImages(true);
        } else {
            state.unreadCount++;
            showUnreadIndicator();
        }
    }

    /**
     * Прокрутка к индикатору непрочитанных сообщений
     */
    function scrollToUnread() {
        // Находим разделитель непрочитанных сообщений
        const divider = elements.list?.querySelector('.unread-divider');
        if (divider) {
            divider.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Если разделителя нет, просто скроллим к низу
        doScrollToBottom();
    }

    /**
     * Принудительный скролл к низу (например, при клике на индикатор)
     */
    function forceScrollToBottom() {
        state.isAtBottom = true;
        doScrollToBottom();
    }

    /**
     * Получить текущее состояние
     */
    function getState() {
        return {
            isAtBottom: state.isAtBottom,
            unreadCount: state.unreadCount,
        };
    }

    /**
     * Сброс состояния (при очистке чата)
     */
    function reset() {
        state.isAtBottom = true;
        state.unreadCount = 0;
        state.wasAtBottom = true;
        hideUnreadIndicator();
    }

    /**
     * Установка состояния "у дна" (для外部 вызова)
     */
    function setAtBottom(value) {
        state.isAtBottom = value;
    }

    // Публичный API
    return {
        init,
        scrollOnPageLoad,
        scrollOnRoomChange,
        scrollOnNewMessage,
        scrollOnNewAttachment,
        scrollToUnread,
        forceScrollToBottom,
        getState,
        reset,
        setAtBottom,
    };
})();

// Делаем доступным глобально
window.ScrollManager = ScrollManager;
