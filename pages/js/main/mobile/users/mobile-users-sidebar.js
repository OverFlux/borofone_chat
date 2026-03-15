// =============================================
// Mobile Users Sidebar Functions (PWA)
// =============================================
function initMobileUsersSidebar() {
    const mobileUsersBtn = document.getElementById('mobileUsersBtn');
    const usersSidebar = document.getElementById('usersSidebar');
    const usersSidebarOverlay = document.getElementById('usersSidebarOverlay');
    
    if (!mobileUsersBtn || !usersSidebar) return;
    
    // Показываем кнопку только на мобильных
    const checkMobile = () => {
        if (window.innerWidth <= 640) {
            mobileUsersBtn.style.display = 'flex';
        } else {
            mobileUsersBtn.style.display = 'none';
            usersSidebar.classList.remove('active');
            if (usersSidebarOverlay) usersSidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    };
    
    // Проверяем при загрузке и при ресайзе
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    // Открытие users sidebar
    mobileUsersBtn.addEventListener('click', () => {
        // Просто добавляем класс active - CSS сделает всю работу
        usersSidebar.classList.add('active');
        if (usersSidebarOverlay) {
            usersSidebarOverlay.classList.add('active');
        }
        document.body.style.overflow = 'hidden';
    });
    
    // Закрытие по оверлею
    if (usersSidebarOverlay) {
        usersSidebarOverlay.addEventListener('click', () => {
            usersSidebar.classList.remove('active');
            usersSidebarOverlay.classList.remove('active');
            document.body.style.overflow = '';
        });
    }
    
    // Swipe gestures для мобильных
    let touchStartX = 0;
    let touchEndX = 0;
    const minSwipeDistance = 50;
    
    // Получаем элементы для обеих панелей
    const roomsSidebar = document.getElementById('roomsSidebar');
    const sidebarOverlay = document.getElementById('roomsSidebarOverlay');
    
    // Swipe на чате - свайп влево открывает комнаты, свайп вправо открывает пользователей
    const chatContainer = document.querySelector('.chat-container') || document.querySelector('.messages-container');
    if (chatContainer) {
        chatContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        chatContainer.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
    }
    
    // Swipe на сайдбаре - свайп закрывает его
    if (usersSidebar) {
        usersSidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        usersSidebar.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSidebarSwipe();
        }, { passive: true });
    }
    
    // Также добавляем обработчик для roomsSidebar
    if (roomsSidebar) {
        roomsSidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        roomsSidebar.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSidebarSwipe();
        }, { passive: true });
    }
    
    // Закрытие по оверлею roomsSidebar
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        sidebarOverlay.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            // При свайпе на оверлее - закрываем комнаты
            if (roomsSidebar && roomsSidebar.classList.contains('active')) {
                roomsSidebar.classList.remove('active');
                // Очищаем inline стили
                roomsSidebar.style.position = '';
                roomsSidebar.style.left = '';
                roomsSidebar.style.top = '';
                roomsSidebar.style.bottom = '';
                roomsSidebar.style.width = '';
                roomsSidebar.style.maxWidth = '';
                roomsSidebar.style.zIndex = '';
                roomsSidebar.style.transform = 'translateX(-100%)';
                roomsSidebar.style.transition = '';
                roomsSidebar.style.borderRadius = '';
                roomsSidebar.style.margin = '';
                
                sidebarOverlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        }, { passive: true });
    }
    
    function handleSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        
        if (window.innerWidth <= 640) {
            // Свайп влево - открыть пользователей (правая панель)
            if (swipeDistance < -minSwipeDistance) {
                if (usersSidebar && !usersSidebar.classList.contains('active')) {
                    usersSidebar.classList.add('active');
                    if (usersSidebarOverlay) {
                        usersSidebarOverlay.classList.add('active');
                    }
                    document.body.style.overflow = 'hidden';
                }
            }
            // Свайп вправо - открыть комнаты (левая панель)
            else if (swipeDistance > minSwipeDistance) {
                if (roomsSidebar && !roomsSidebar.classList.contains('active')) {
                    // Добавляем inline стили как в mobile-menu.js
                    roomsSidebar.style.position = 'fixed';
                    roomsSidebar.style.left = '0';
                    roomsSidebar.style.top = '0';
                    roomsSidebar.style.bottom = '0';
                    roomsSidebar.style.width = '85%';
                    roomsSidebar.style.maxWidth = '300px';
                    roomsSidebar.style.zIndex = '1000';
                    roomsSidebar.style.transform = 'translateX(0)';
                    roomsSidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                    roomsSidebar.style.borderRadius = '0';
                    roomsSidebar.style.margin = '8px 0 8px 8px';
                    
                    roomsSidebar.classList.add('active');
                    if (sidebarOverlay) {
                        sidebarOverlay.classList.add('active');
                    }
                    document.body.style.overflow = 'hidden';
                }
            }
        }
    }
    
    function handleSidebarSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        // Свайп влево - закрыть пользователей
        if (swipeDistance < -minSwipeDistance && window.innerWidth <= 640) {
            if (usersSidebar && usersSidebar.classList.contains('active')) {
                usersSidebar.classList.remove('active');
                if (usersSidebarOverlay) {
                    usersSidebarOverlay.classList.remove('active');
                }
                document.body.style.overflow = '';
            }
        }
        // Свайп вправо - закрыть комнаты
        if (swipeDistance > minSwipeDistance && window.innerWidth <= 640) {
            if (roomsSidebar && roomsSidebar.classList.contains('active')) {
                roomsSidebar.classList.remove('active');
                // Очищаем inline стили
                roomsSidebar.style.position = '';
                roomsSidebar.style.left = '';
                roomsSidebar.style.top = '';
                roomsSidebar.style.bottom = '';
                roomsSidebar.style.width = '';
                roomsSidebar.style.maxWidth = '';
                roomsSidebar.style.zIndex = '';
                roomsSidebar.style.transform = 'translateX(-100%)';
                roomsSidebar.style.transition = '';
                roomsSidebar.style.borderRadius = '';
                roomsSidebar.style.margin = '';
                
                if (sidebarOverlay) {
                    sidebarOverlay.classList.remove('active');
                }
                document.body.style.overflow = '';
            }
        }
    }
}

// Инициализируем мобильное меню
initMobileMenu();

// Инициализируем мобильную панель пользователей
initMobileUsersSidebar();

init();
