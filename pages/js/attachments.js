// ==========================================
// ATTACHMENTS (вложения)
// ==========================================

/**
 * Модуль для работы с вложениями.
 * 
 * Пока без сохранения в БД — только отображение на фронте.
 * TODO: После добавления таблицы attachments — сохранять в БД.
 */

let attachmentsToSend = [];  // Временное хранилище файлов для отправки

/**
 * Открыть диалог выбора файлов.
 */
function openAttachmentDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,.pdf,.doc,.docx,.txt,.zip,.rar';
    
    input.onchange = (e) => {
        const files = Array.from(e.target.files);
        addAttachments(files);
    };
    
    input.click();
}

/**
 * Добавить файлы в список вложений.
 */
function addAttachments(files) {
    files.forEach(file => {
        // Проверка размера (макс 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert(`Файл "${file.name}" слишком большой (макс 10MB)`);
            return;
        }
        
        attachmentsToSend.push(file);
    });
    
    renderAttachmentsPreviews();
}

/**
 * Отобразить превью вложений перед отправкой.
 */
function renderAttachmentsPreviews() {
    let container = document.getElementById('attachmentsPreviews');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'attachmentsPreviews';
        container.className = 'attachments-previews';
        document.querySelector('.message-input-container').insertBefore(
            container,
            document.querySelector('.message-form')
        );
    }
    
    if (attachmentsToSend.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = attachmentsToSend.map((file, index) => {
        const isImage = file.type.startsWith('image/');
        const icon = isImage ? '🖼️' : '📄';
        
        return `
            <div class="attachment-preview" data-index="${index}">
                <span class="attachment-icon">${icon}</span>
                <span class="attachment-name">${escapeHtml(file.name)}</span>
                <button class="attachment-remove" onclick="removeAttachment(${index})">✕</button>
            </div>
        `;
    }).join('');
}

/**
 * Удалить вложение из списка.
 */
function removeAttachment(index) {
    attachmentsToSend.splice(index, 1);
    renderAttachmentsPreviews();
}

/**
 * Загрузить вложения на сервер.
 * 
 * @returns {Array} Список загруженных файлов с URL
 */
async function uploadAttachments() {
    if (attachmentsToSend.length === 0) return [];
    
    const formData = new FormData();
    attachmentsToSend.forEach(file => {
        formData.append('files', file);
    });
    
    try {
        const response = await fetchWithAuth(`${API_URL}/attachments/upload`, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            throw new Error('Failed to upload attachments');
        }
        
        const uploaded = await response.json();
        return uploaded;
    } catch (err) {
        console.error('Failed to upload attachments:', err);
        throw err;
    }
}

/**
 * Отобразить вложения в сообщении.
 */
function renderMessageAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';
    
    // Helper to escape HTML (fallback if not available in scope)
    const escapeHtmlLocal = (text) => {
        if (typeof escapeHtml !== 'undefined') return escapeHtml(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    // Helper to resolve file URL
    const resolveFileUrl = (path) => {
        if (!path) return '';
        if (path.startsWith('http://') || path.startsWith('https://')) return path;
        // Path like /uploads/attachments/xxx.jpg
        if (path.startsWith('/')) return path;
        // Relative path
        return '/' + path;
    };
    
    // Count images for grid layout
    const images = attachments.filter(att => att.mime_type?.startsWith('image/'));
    const hasMultipleImages = images.length > 1;
    const imageCount = images.length;
    
    // Build class names for grid
    let containerClass = 'message-attachments';
    if (hasMultipleImages) {
        containerClass += ' has-multiple-images';
        if (imageCount === 2) containerClass += ' has-2-images';
        else if (imageCount === 3) containerClass += ' has-3-images';
        else if (imageCount === 4) containerClass += ' has-4-images';
    }
    
    return `
        <div class="${containerClass}">
            ${attachments.map(att => {
                const isImage = att.mime_type?.startsWith('image/');
                const isVideo = att.mime_type?.startsWith('video/');
                const fileUrl = resolveFileUrl(att.file_path);
                
                if (isImage) {
                    return `
                        <div class="attachment-image" onclick="openImageLightbox('${escapeHtmlLocal(fileUrl)}')">
                            <img src="${escapeHtmlLocal(fileUrl)}" alt="${escapeHtmlLocal(att.filename)}" loading="lazy">
                        </div>
                    `;
                } else if (isVideo) {
                    return `
                        <div class="attachment-video">
                            <video controls preload="metadata">
                                <source src="${escapeHtmlLocal(fileUrl)}" type="${escapeHtmlLocal(att.mime_type)}">
                            </video>
                        </div>
                    `;
                } else {
                    const size = formatFileSize(att.file_size);
                    return `
                        <a href="${escapeHtmlLocal(fileUrl)}" class="attachment-file" download="${escapeHtmlLocal(att.filename)}">
                            <span class="attachment-file-icon">📄</span>
                            <div class="attachment-file-info">
                                <div class="attachment-file-name">${escapeHtmlLocal(att.filename)}</div>
                                <div class="attachment-file-size">${size}</div>
                            </div>
                            <span class="attachment-download-icon">⬇</span>
                        </a>
                    `;
                }
            }).join('')}
        </div>
    `;
}

/**
 * Открыть изображение в модальном окне (lightbox).
 */
window.openImageLightbox = function(imageUrl) {
    // Remove existing lightbox if any
    closeImageLightbox();
    
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.onclick = (e) => {
        if (e.target === lightbox || e.target.classList.contains('image-lightbox-close')) {
            closeImageLightbox();
        }
    };
    
    lightbox.innerHTML = `
        <button class="image-lightbox-close" onclick="closeImageLightbox()">✕</button>
        <img src="${imageUrl}" alt="Full size image" onclick="event.stopPropagation()">
    `;
    
    document.body.appendChild(lightbox);
    
    // Trigger animation
    requestAnimationFrame(() => {
        lightbox.classList.add('active');
    });
    
    // Close on Escape key
    document.addEventListener('keydown', handleLightboxKeydown);
}

/**
 * Закрыть модальное окно с изображением.
 */
window.closeImageLightbox = function() {
    const lightbox = document.querySelector('.image-lightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
        setTimeout(() => lightbox.remove(), 200);
    }
    document.removeEventListener('keydown', handleLightboxKeydown);
}

/**
 * Обработчик клавиш для lightbox.
 */
function handleLightboxKeydown(e) {
    if (e.key === 'Escape') {
        closeImageLightbox();
    }
}

/**
 * Форматировать размер файла (bytes → KB/MB).
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Экспорт для использования в main.js
window.attachments = {
    openAttachmentDialog,
    addAttachments,
    removeAttachment,
    uploadAttachments,
    renderMessageAttachments,
    openImageLightbox,
    closeImageLightbox,
    getAttachmentsToSend: () => attachmentsToSend,
    clearAttachments: () => {
        attachmentsToSend = [];
        renderAttachmentsPreviews();
    },
};
