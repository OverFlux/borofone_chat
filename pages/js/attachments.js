// ==========================================
// ATTACHMENTS (вложения)
// ==========================================

/**
 * Модуль для работы с вложениями.
 * Реализует drag-and-drop функционал как в Telegram/Discord
 */

let attachmentsToSend = [];  //
const attachmentPreviewUrls = new Map();
const dropZonePreviewUrls = new Set();

function revokeObjectUrlSafe(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return;
    try {
        URL.revokeObjectURL(url);
    } catch (_) {
        // Ignore blob cleanup errors.
    }
}

function clearAttachmentPreviewUrls() {
    attachmentPreviewUrls.forEach((url) => revokeObjectUrlSafe(url));
    attachmentPreviewUrls.clear();
}

function clearDropZonePreviewUrls() {
    dropZonePreviewUrls.forEach((url) => revokeObjectUrlSafe(url));
    dropZonePreviewUrls.clear();

    const previewsContainer = document.getElementById('dropZonePreviews');
    if (previewsContainer) {
        previewsContainer.innerHTML = '';
    }
}

function destroyAudioPlayerInstance(fileId) {
    const player = audioPlayerInstances.get(fileId);
    if (!player) return;

    if (currentPlayingAudio === fileId) {
        currentPlayingAudio = null;
    }

    try {
        player.audio.pause();
        player.audio.removeAttribute('src');
        player.audio.src = '';
        player.audio.load();
    } catch (_) {
        // Ignore audio disposal errors.
    }

    audioPlayerInstances.delete(fileId);
}

function cleanupDetachedAudioPlayers() {
    audioPlayerInstances.forEach((player, fileId) => {
        if (!player.card || player.card.isConnected) return;
        destroyAudioPlayerInstance(fileId);
    });
}

function disposeAllAudioPlayers() {
    Array.from(audioPlayerInstances.keys()).forEach((fileId) => {
        destroyAudioPlayerInstance(fileId);
    });
}

// Временное хранилище файлов для отправки

// Global helper functions for use in audio player
function _resolveFileUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/')) return path;
    return '/' + path;
}

function _escapeHtmlLocal(text) {
    if (typeof escapeHtml !== 'undefined') return escapeHtml(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Drag and drop state
let dragDropState = {
    isDragging: false,
    files: [],
    uploadXhr: null,
    isUploading: false,
    draggedFilesCache: new Map() // Cache for file previews
};

// Allowed file types and max size
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total for multiple files

const ALLOWED_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed', 'application/vnd.rar',
    'audio/mpeg', 'audio/wav', 'audio/ogg'
];

// File type icons with better visual differentiation
const FILE_TYPE_ICONS = {
    image: {
        emoji: '🖼️',
        color: '#5865F2',
        label: 'Image'
    },
    video: {
        emoji: '🎬',
        color: '#ED4245',
        label: 'Video'
    },
    audio: {
        emoji: '🎵',
        color: '#FAa61a',
        label: 'Audio'
    },
    pdf: {
        emoji: '📕',
        color: '#ED4245',
        label: 'PDF'
    },
    word: {
        emoji: '📝',
        color: '#5865F2',
        label: 'Document'
    },
    text: {
        emoji: '📄',
        color: '#b5bac1',
        label: 'Text'
    },
    zip: {
        emoji: '📦',
        color: '#FAa61a',
        label: 'Archive'
    },
    rar: {
        emoji: '📦',
        color: '#FAa61a',
        label: 'Archive'
    },
    default: {
        emoji: '📎',
        color: '#b5bac1',
        label: 'File'
    }
};

// ==========================================
// FILE VALIDATION
// ==========================================

/**
 * Validate a single file
 */
function validateFile(file) {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
        return {
            valid: false,
            error: ` слишком большой (макс ${formatFileSize(MAX_FILE_SIZE)})`,
            code: 'SIZE_TOO_LARGE'
        };
    }

    // Check file type
    const fileType = file.type.toLowerCase();
    const fileExtension = file.name.split('.').pop().toLowerCase();

    // Special handling for files without type
    if (!fileType) {
        // Check by extension
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'pdf', 'doc', 'docx', 'txt', 'zip', 'rar', 'mp3', 'wav', 'ogg'];
        if (!allowedExtensions.includes(fileExtension)) {
            return { valid: false, error: ' неподдерживаемый формат', code: 'UNSUPPORTED_TYPE' };
        }
        return { valid: true };
    }

    // Check against allowed types
    const isAllowed = ALLOWED_TYPES.some(type => {
        if (type.endsWith('*')) {
            return fileType.startsWith(type.replace('*', ''));
        }
        return fileType === type;
    });

    if (!isAllowed) {
        return { valid: false, error: ' неподдерживаемый тип файла', code: 'UNSUPPORTED_TYPE' };
    }

    return { valid: true };
}

/**
 * Validate multiple files - check total size
 */
function validateFilesTotal(files) {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
        return {
            valid: false,
            error: `Общий размер файлов слишком большой (макс ${formatFileSize(MAX_TOTAL_SIZE)})`,
            code: 'TOTAL_SIZE_TOO_LARGE'
        };
    }
    return { valid: true };
}

/**
 * Get file type info
 */
function getFileTypeInfo(file) {
    const type = file.type || '';
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (type.startsWith('image/')) return { ...FILE_TYPE_ICONS.image, isImage: true };
    if (type.startsWith('video/')) return { ...FILE_TYPE_ICONS.video, isVideo: true };
    if (type.startsWith('audio/')) return { ...FILE_TYPE_ICONS.audio, isAudio: true };
    if (type.includes('pdf')) return FILE_TYPE_ICONS.pdf;
    if (type.includes('word') || type.includes('document')) return FILE_TYPE_ICONS.word;
    if (type.startsWith('text/')) return FILE_TYPE_ICONS.text;
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FILE_TYPE_ICONS.zip;
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return { ...FILE_TYPE_ICONS.image, isImage: true };
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) return { ...FILE_TYPE_ICONS.video, isVideo: true };
    if (['mp3', 'wav', 'ogg'].includes(ext)) return { ...FILE_TYPE_ICONS.audio, isAudio: true };
    
    return FILE_TYPE_ICONS.default;
}

/**
 * Get file type icon
 */
function getFileTypeIcon(file) {
    return getFileTypeInfo(file).emoji;
}

// ==========================================
// UI HELPERS
// ==========================================

/**
 * Открыть диалог выбора файлов.
 */
function openAttachmentDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar,.mp3,.wav,.ogg';
    
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
    const validFiles = [];
    const errors = [];

    files.forEach(file => {
        const validation = validateFile(file);
        if (validation.valid) {
            // Check if file already exists in attachments
            const exists = attachmentsToSend.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
                validFiles.push(file);
            }
        } else {
            errors.push(`"${file.name}"${validation.error}`);
        }
    });

    // Check total size
    if (attachmentsToSend.length + validFiles.length > 1) {
        const totalValidation = validateFilesTotal([...attachmentsToSend, ...validFiles]);
        if (!totalValidation.valid) {
            showErrorToast(totalValidation.error);
            return;
        }
    }

    // Show errors if any
    if (errors.length > 0) {
        showErrorToast(errors.join('\n'));
    }

    // Add valid files to attachments
    if (validFiles.length > 0) {
        attachmentsToSend.push(...validFiles);
        renderAttachmentsPreviews();
    }
}

/**
 * Отобразить превью вложений перед отправкой.
 */
function renderAttachmentsPreviews() {
    clearAttachmentPreviewUrls();
    cleanupDetachedAudioPlayers();

    let container = document.getElementById('attachmentsPreviews');
    
    if (!container) {
        container = document.createElement('div');
        container.id = 'attachmentsPreviews';
        container.className = 'attachments-previews';
        
        const messageForm = document.querySelector('.message-form');
        if (messageForm) {
            const inputContainer = document.querySelector('.message-input-container');
            if (inputContainer) {
                inputContainer.insertBefore(container, messageForm);
            }
        }
    }
    
    if (attachmentsToSend.length === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    
    container.style.display = 'flex';
    container.innerHTML = attachmentsToSend.map((file, index) => {
        const typeInfo = getFileTypeInfo(file);
        const isImage = typeInfo.isImage;
        
        let iconContent;
        if (isImage) {
            // Create object URL for preview
            const objectUrl = URL.createObjectURL(file);
            attachmentPreviewUrls.set(index, objectUrl);
            iconContent = `<img src="${objectUrl}" alt="${escapeHtml(file.name)}" loading="lazy">`;
        } else {
            iconContent = `<span class="attachment-icon">${typeInfo.emoji}</span>`;
        }
        
        return `
            <div class="attachment-preview" data-index="${index}">
                ${iconContent}
                <div class="attachment-details">
                    <span class="attachment-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                    <span class="attachment-size">${formatFileSize(file.size)}</span>
                </div>
                <button class="attachment-remove" onclick="removeAttachment(${index})" title="Удалить">&times;</button>
            </div>
        `;
    }).join('');
}

/**
 * Удалить вложение из списка.
 */
function removeAttachment(index) {
    clearAttachmentPreviewUrls();
    attachmentsToSend.splice(index, 1);
    renderAttachmentsPreviews();
}

/**
 * Очистить все вложения.
 */
function clearAllAttachments() {
    clearAttachmentPreviewUrls();
    attachmentsToSend = [];
    renderAttachmentsPreviews();
}

// ==========================================
// UPLOAD FUNCTIONALITY
// ==========================================

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
        
        // Clear attachments after successful upload
        clearAttachmentPreviewUrls();
        attachmentsToSend = [];
        renderAttachmentsPreviews();
        
        return uploaded;
    } catch (err) {
        console.error('Failed to upload attachments:', err);
        throw err;
    }
}

/**
 * Upload attachments with progress display in drop zone
 */
async function uploadAttachmentsWithProgress() {
    if (attachmentsToSend.length === 0) return [];

    const overlay = document.querySelector('.drag-drop-overlay');
    const progressContainer = document.getElementById('dropUploadProgress');
    const progressBar = document.getElementById('dropProgressBar');
    const progressText = document.getElementById('dropProgressText');
    const cancelBtn = document.getElementById('dropCancelBtn');

    if (!overlay || attachmentsToSend.length === 0) return [];

    // Show progress UI
    progressContainer.style.display = 'block';
    cancelBtn.style.display = 'block';

    // Hide previews during upload
    const previewsContainer = document.getElementById('dropZonePreviews');
    if (previewsContainer) {
        previewsContainer.style.display = 'none';
    }

    // Update title
    const titleEl = overlay.querySelector('.drop-zone-title');
    const subtitleEl = overlay.querySelector('.drop-zone-subtitle');
    const iconEl = overlay.querySelector('.drop-zone-icon');

    const totalSize = attachmentsToSend.reduce((sum, f) => sum + f.size, 0);
    titleEl.textContent = 'Загрузка файлов...';
    subtitleEl.textContent = `${attachmentsToSend.length} файл(ов) • ${formatFileSize(totalSize)}`;

    const formData = new FormData();
    attachmentsToSend.forEach(file => {
        formData.append('files', file);
    });

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        dragDropState.uploadXhr = xhr;
        dragDropState.isUploading = true;

        // Progress handler
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = percent + '%';
                
                const loadedSize = formatFileSize(e.loaded);
                const totalSizeStr = formatFileSize(e.total);
                progressText.innerHTML = `
                    <span class="drop-progress-file">${loadedSize} / ${totalSizeStr}</span>
                    <span class="drop-progress-percent">${percent}%</span>
                `;
            }
        };

        // Load handler
        xhr.onload = () => {
            dragDropState.isUploading = false;
            progressContainer.style.display = 'none';
            cancelBtn.style.display = 'none';

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const uploaded = JSON.parse(xhr.responseText);
                    
                    // Show success
                    overlay.classList.add('drop-zone-success');
                    titleEl.textContent = 'Загрузка завершена!';
                    iconEl.innerHTML = '<span class="success-pop-icon">вњ…</span>';
                    subtitleEl.textContent = `${uploaded.length} файл(ов) готовы к отправке`;

                    // Clear attachments
                    clearAttachmentPreviewUrls();
                    attachmentsToSend = [];
                    renderAttachmentsPreviews();

                    // Hide overlay after delay
                    setTimeout(() => {
                        hideDropZoneOverlay();
                        // Reset UI
                        overlay.classList.remove('drop-zone-success');
                        resetDropZoneUI();
                        progressBar.style.width = '0%';
                    }, 2000);

                    resolve(uploaded);
                } catch (e) {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                try {
                    const error = JSON.parse(xhr.responseText);
                    reject(new Error(error.detail || 'Upload failed'));
                } catch (e) {
                    reject(new Error('Upload failed: ' + xhr.status));
                }
            }
        };

        // Error handler
        xhr.onerror = () => {
            dragDropState.isUploading = false;
            progressContainer.style.display = 'none';
            cancelBtn.style.display = 'none';
            
            overlay.classList.add('drop-zone-error');
            titleEl.textContent = 'Ошибка загрузки';
            subtitleEl.textContent = 'Проверьте соединение и попробуйте снова';
            iconEl.textContent = '❌';
            
            setTimeout(() => {
                overlay.classList.remove('drop-zone-error');
                hideDropZoneOverlay();
                resetDropZoneUI();
            }, 3000);
            
            reject(new Error('Network error'));
        };

        // Abort handler
        xhr.onabort = () => {
            dragDropState.isUploading = false;
            progressContainer.style.display = 'none';
            cancelBtn.style.display = 'none';
            
            titleEl.textContent = 'Загрузка отменена';
            subtitleEl.textContent = 'Файлы можно прикрепить другим способом';
            
            setTimeout(() => {
                hideDropZoneOverlay();
                resetDropZoneUI();
            }, 1500);
            
            resolve([]);
        };

        // Send request
        const authToken = localStorage.getItem('token') || sessionStorage.getItem('token');
        xhr.open('POST', `${getApiUrl()}/attachments/upload`);
        if (authToken) {
            xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        }
        xhr.send(formData);
    });
}

/**
 * Cancel ongoing upload
 */
function cancelUpload() {
    if (dragDropState.uploadXhr && dragDropState.isUploading) {
        dragDropState.uploadXhr.abort();
    }
}

/**
 * Reset drop zone UI to default state
 */
function resetDropZoneUI() {
    const overlay = document.querySelector('.drag-drop-overlay');
    if (!overlay) return;
    
    const titleEl = overlay.querySelector('.drop-zone-title');
    const subtitleEl = overlay.querySelector('.drop-zone-subtitle');
    const iconEl = overlay.querySelector('.drop-zone-icon');
    const previewsContainer = document.getElementById('dropZonePreviews');
    const progressContainer = document.getElementById('dropUploadProgress');
    const cancelBtn = document.getElementById('dropCancelBtn');
    
    if (titleEl) titleEl.textContent = 'Перетащите файлы сюда';
    if (subtitleEl) subtitleEl.textContent = 'или отпустите для загрузки';
    if (iconEl) iconEl.innerHTML = '';
    if (previewsContainer) previewsContainer.style.display = '';
    if (progressContainer) progressContainer.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

// ==========================================
// DRAG AND DROP FUNCTIONALITY
// ==========================================

/**
 * Initialize drag and drop handlers
 */
function initDragAndDrop() {
    // Prevent default drag behaviors on window
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, { passive: false });
        document.addEventListener(eventName, preventDefaults, { passive: false });
    });

    // Highlight drop zone on drag enter/over
    ['dragenter', 'dragover'].forEach(eventName => {
        document.body.addEventListener(eventName, handleDragEnter, { passive: false });
    });

    // Remove highlight on drag leave/drop
    ['dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, handleDragLeave, { passive: false });
    });

    // Handle dropped files
    document.body.addEventListener('drop', handleDrop, { passive: false });

    // Create edge indicators
    createEdgeIndicators();

    // Mobile touch support
    initMobileDragDrop();
}

/**
 * Prevent default browser drag behaviors
 */
function preventDefaults(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    if (e.stopPropagation) {
        e.stopPropagation();
    }
}

/**
 * Create edge indicators for better drag feedback
 */
function createEdgeIndicators() {
    const edges = ['top', 'bottom', 'left', 'right'];
    edges.forEach(edge => {
        const indicator = document.createElement('div');
        indicator.className = `drag-edge-indicator ${edge}`;
        document.body.appendChild(indicator);
    });
}

/**
 * Handle drag enter - show drop zone overlay
 */
function handleDragEnter(e) {
    const dataTransfer = e.dataTransfer || e.originalEvent?.dataTransfer;
    if (!dataTransfer) return;

    // Check if dragging files (not text or other data)
    const types = Array.from(dataTransfer.types || []);
    if (!types.includes('Files') && !types.includes('application/x-moz-file')) return;

    e.preventDefault();
    
    if (dragDropState.isDragging) return; // Already showing
    
    dragDropState.isDragging = true;
    document.body.classList.add('dragging-files');

    // Show edge indicators
    document.querySelectorAll('.drag-edge-indicator').forEach(el => {
        el.classList.add('active');
    });

    // Show drop zone overlay with file info
    showDropZoneOverlay(dataTransfer.items, dataTransfer.files);
}

/**
 * Handle drag leave - potentially hide overlay
 */
function handleDragLeave(e) {
    const relatedTarget = e.relatedTarget;
    
    // Check if we're leaving the window or moving to a child element
    if (!relatedTarget || relatedTarget === document.documentElement || 
        (e.target === document.documentElement)) {
        
        dragDropState.isDragging = false;
        document.body.classList.remove('dragging-files');
        
        // Hide edge indicators
        document.querySelectorAll('.drag-edge-indicator').forEach(el => {
            el.classList.remove('active');
        });
        
        hideDropZoneOverlay();
    }
}

/**
 * Handle dropped files
 */
function handleDrop(e) {
    e.preventDefault();
    
    dragDropState.isDragging = false;
    document.body.classList.remove('dragging-files');

    // Hide edge indicators
    document.querySelectorAll('.drag-edge-indicator').forEach(el => {
        el.classList.remove('active');
    });

    const dataTransfer = e.dataTransfer || e.originalEvent?.dataTransfer;
    if (!dataTransfer) return;

    // Get files from drop
    const files = Array.from(dataTransfer.files);

    if (files.length > 0) {
        // Process dropped files
        processDroppedFiles(files);
    }

    hideDropZoneOverlay();
}

/**
 * Show drop zone overlay with file previews
 */
function showDropZoneOverlay(items, files) {
    let overlay = document.querySelector('.drag-drop-overlay');

    if (!overlay) {
        overlay = createDropZoneOverlay();
        document.body.appendChild(overlay);
    }

    // Add dragging class for enhanced animation
    requestAnimationFrame(() => {
        overlay.classList.add('active');
        setTimeout(() => {
            overlay.classList.add('dragging');
        }, 50);
    });

    // Generate previews
    if (files && files.length > 0) {
        renderDropZonePreviews(files);
    }
}

/**
 * Hide drop zone overlay
 */
function hideDropZoneOverlay() {
    clearDropZonePreviewUrls();

    const overlay = document.querySelector('.drag-drop-overlay');
    if (overlay) {
        overlay.classList.remove('active', 'dragging');
    }
}

/**
 * Create drop zone overlay element - Glass style
 */
function createDropZoneOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'drag-drop-overlay';
    overlay.innerHTML = `
        <div class="drop-zone-content">
            <div class="drop-zone-icon"></div>
            <div class="drop-zone-text">
                <div class="drop-zone-title">Перетащите файлы сюда</div>
                <div class="drop-zone-subtitle">или отпустите для загрузки</div>
            </div>
            <div class="drop-zone-file-types" id="dropZoneFileTypes"></div>
            <div class="drop-zone-previews" id="dropZonePreviews"></div>
            <div class="drop-upload-progress" id="dropUploadProgress" style="display: none;">
                <div class="drop-progress-bar-container">
                    <div class="drop-progress-bar" id="dropProgressBar"></div>
                </div>
                <div class="drop-progress-text">
                    <span class="drop-progress-file">Подготовка...</span>
                    <span class="drop-progress-percent">0%</span>
                </div>
            </div>
            <button class="drop-cancel-btn" id="dropCancelBtn" style="display: none;">Отмена</button>
        </div>
    `;

    // Add cancel button handler
    overlay.querySelector('#dropCancelBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelUpload();
    });

    // Prevent click from closing overlay
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    return overlay;
}

/**
 * Render file previews in drop zone
 */
function renderDropZonePreviews(files) {
    clearDropZonePreviewUrls();

    const previewsContainer = document.getElementById('dropZonePreviews');
    const fileTypesContainer = document.getElementById('dropZoneFileTypes');
    
    if (!previewsContainer) return;
    
    // Collect unique file types
    const fileTypes = new Set();
    const fileTypeCounts = {};
    
    const previewHTML = Array.from(files).map((file, index) => {
        const validation = validateFile(file);
        const typeInfo = getFileTypeInfo(file);
        
        fileTypes.add(typeInfo.label);
        fileTypeCounts[typeInfo.label] = (fileTypeCounts[typeInfo.label] || 0) + 1;
        
        const isImage = typeInfo.isImage;
        const isValid = validation.valid;
        
        let previewContent;
        if (isImage) {
            const objectUrl = URL.createObjectURL(file);
            dropZonePreviewUrls.add(objectUrl);
            previewContent = `
                <img class="drop-preview-image" src="${objectUrl}" alt="${escapeHtml(file.name)}" 
                     onload="this.style.opacity=1" 
                     onerror="this.style.display='none'">
            `;
        } else {
            previewContent = `
                <div class="drop-preview-icon">
                    <span class="icon-emoji">${typeInfo.emoji}</span>
                    <span class="icon-text">${file.name.split('.').pop().toUpperCase()}</span>
                </div>
            `;
        }
        
        return `
            <div class="drop-preview-card ${isValid ? 'valid' : 'invalid'}" style="animation-delay: ${index * 0.05}s">
                ${previewContent}
                <div class="drop-preview-info">
                    <div class="drop-preview-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="drop-preview-meta">
                        <span class="drop-preview-size">${formatFileSize(file.size)}</span>
                        <span class="drop-preview-type">${file.name.split('.').pop().toUpperCase()}</span>
                    </div>
                </div>
                ${!isValid ? `<div class="drop-preview-error">${validation.error}</div>` : ''}
            </div>
        `;
    }).join('');
    
    previewsContainer.innerHTML = previewHTML;
    
    // Update file types badges
    if (fileTypesContainer) {
        const typesHTML = Array.from(fileTypes).map(type => 
            `<span class="drop-file-type-badge">${type} (${fileTypeCounts[type]})</span>`
        ).join('');
        fileTypesContainer.innerHTML = typesHTML;
    }
    
    // Add total files indicator
    const totalSize = Array.from(files).reduce((sum, f) => sum + f.size, 0);
    const totalFiles = files.length;
    
    const existingTotal = document.querySelector('.drop-total-files');
    if (existingTotal) {
        existingTotal.remove();
    }
    
    const totalDiv = document.createElement('div');
    totalDiv.className = 'drop-total-files';
    totalDiv.innerHTML = `
        <span class="drop-total-count">${totalFiles}</span>
        <span>файл(ов) • ${formatFileSize(totalSize)}</span>
    `;
    previewsContainer.appendChild(totalDiv);
}

/**
 * Process dropped files - validate and add to attachments
 */
function processDroppedFiles(files) {
    const validFiles = [];
    const errors = [];

    files.forEach(file => {
        const validation = validateFile(file);
        if (validation.valid) {
            validFiles.push(file);
        } else {
            errors.push(`${file.name}: ${validation.error}`);
        }
    });

    // Show errors if any
    if (errors.length > 0) {
        showErrorToast(errors.join('\n'));
    }

    // Add valid files to attachments
    if (validFiles.length > 0) {
        addAttachments(validFiles);
    }
}

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

/**
 * Show error toast notification - Glass style
 */
function showErrorToast(message) {
    // Remove existing toast
    const existingToast = document.querySelector('.drag-error-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'drag-error-toast';
    toast.innerHTML = `
        <span class="drag-error-toast-icon">⚠️</span>
        <span class="drag-error-toast-message">${escapeHtml(message).replace(/\n/g, '<br>')}</span>
        <button class="drag-error-toast-close">&times;</button>
    `;

    toast.querySelector('.drag-error-toast-close').addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    });

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto-hide after 6 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }
    }, 6000);
}

// ==========================================
// MOBILE/TOUCH SUPPORT
// ==========================================

/**
 * Initialize mobile/touch drag and drop
 */
function initMobileDragDrop() {
    // For mobile, we use a different approach - file input triggered by touch
    let touchTimer = null;
    let touchStartY = 0;
    let touchStartX = 0;

    document.body.addEventListener('touchstart', (e) => {
        // Only handle multi-touch with files
        if (e.touches.length !== 2) return;

        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;

        // Start timer to detect long press
        touchTimer = setTimeout(() => {
            // Show mobile file picker
            openAttachmentDialog();
        }, 600);
    }, { passive: true });

    document.body.addEventListener('touchmove', (e) => {
        // Cancel timer if user moves fingers
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }

        // Detect drag gesture
        if (e.touches.length === 2) {
            const currentY = e.touches[0].clientY;
            const currentX = e.touches[0].clientX;
            const deltaY = Math.abs(currentY - touchStartY);
            const deltaX = Math.abs(currentX - touchStartX);

            if (deltaY > 20 || deltaX > 20) {
                // User is dragging - show hint
                showMobileDropHint(true);
            }
        }
    }, { passive: true });

    document.body.addEventListener('touchend', () => {
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }
        showMobileDropHint(false);
    }, { passive: true });
}

/**
 * Show mobile drop hint - Glass style
 */
function showMobileDropHint(show) {
    let hint = document.querySelector('.mobile-drop-hint');

    if (!hint && show) {
        hint = document.createElement('div');
        hint.className = 'mobile-drop-hint';
        hint.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(145deg, var(--glass-bg, rgba(30, 31, 34, 0.85)), rgba(255, 255, 255, 0.05));
            backdrop-filter: blur(20px) saturate(150%);
            -webkit-backdrop-filter: blur(20px) saturate(150%);
            border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.1));
            color: var(--text-primary, #fff);
            padding: 14px 24px;
            border-radius: 16px;
            font-size: 14px;
            font-weight: 500;
            z-index: 9999;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            animation: hintSlideUp 0.3s ease;
        `;
        hint.innerHTML = `
            <span style="font-size: 20px;">📎</span>
            <span>Нажмите для выбора файлов</span>
        `;
        document.body.appendChild(hint);
    } else if (hint && !show) {
        hint.style.animation = 'hintSlideDown 0.2s ease forwards';
        setTimeout(() => hint.remove(), 200);
    }
}

// ==========================================
// PASTE FROM CLIPBOARD
// ==========================================

/**
 * Обработчик вставки из буфера обмена (Ctrl+V).
 * Поддерживает изображения и файлы из буфера обмена.
 */
function handlePaste(event) {
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    
    const items = clipboardData.items;
    if (!items) return;
    
    const files = [];
    
    // Перебираем элементы буфера обмена
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Проверяем, является ли элемент файлом
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                // Генерируем имя файла если его нет (например, для скриншотов)
                if (!file.name || file.name === 'image.png') {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const extension = file.type.split('/')[1] || 'png';
                    const newName = `clipboard-${timestamp}.${extension}`;
                    
                    // Создаём новый File объект с правильным именем
                    const namedFile = new File([file], newName, { type: file.type });
                    files.push(namedFile);
                } else {
                    files.push(file);
                }
            }
        }
    }
    
    if (files.length > 0) {
        // Предотвращаем вставку как текст
        event.preventDefault();
        
        // Добавляем файлы через существующую функцию
        addAttachments(files);
        
        // Фокусируемся на поле ввода для удобства
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.focus();
        }
    }
}

/**
 * Инициализация обработчика вставки.
 * Вызывается при загрузке страницы.
 */
function initPasteHandler() {
    // Слушаем paste на всём документе
    document.addEventListener('paste', handlePaste);
}

// ==========================================
// MESSAGE ATTACHMENTS RENDERING
// ==========================================

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
                const isAudio = att.mime_type?.startsWith('audio/');
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
                            <video controls preload="metadata" playsinline>
                                <source src="${escapeHtmlLocal(fileUrl)}" type="${escapeHtmlLocal(att.mime_type)}">
                            </video>
                        </div>
                    `;
                } else if (isAudio) {
                    // Render audio player
                    return createAudioPlayerHTML(att);
                } else {
                    const size = formatFileSize(att.file_size);
                    return `
                        <a href="${escapeHtmlLocal(fileUrl)}" class="attachment-file" download="${escapeHtmlLocal(att.filename)}">
                            <span class="attachment-file-icon">${getFileTypeIcon({ type: att.mime_type, name: att.filename })}</span>
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
        <button class="image-lightbox-close" onclick="closeImageLightbox()">&times;</button>
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

// ==========================================
// INITIALIZATION
// ==========================================

// Инициализируем при загрузке скрипта
initPasteHandler();
initDragAndDrop();

// ==========================================
// AUDIO PLAYER FUNCTIONALITY
// ==========================================

// Global audio player state
let currentPlayingAudio = null;
let audioPlayerInstances = new Map();

/**
 * Format time in seconds to MM:SS format
 */
function formatAudioTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Create an audio player element for a given file
 */
function createAudioPlayerHTML(attachment) {
    const fileUrl = _resolveFileUrl(attachment.file_path);
    const filename = _escapeHtmlLocal(attachment.filename);
    const fileId = 'audio-' + Math.random().toString(36).substr(2, 9);
    const safeFileUrl = _escapeHtmlLocal(fileUrl);
    
    return `
        <div class="audio-player-card" data-file-url="${safeFileUrl}" data-file-id="${fileId}" data-filename="${filename}">
            <div class="audio-player-main">
                <button class="audio-player-play-btn-large">
                    <svg class="audio-player-play-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                    </svg>
                    <svg class="audio-player-pause-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                    <div class="audio-player-loading"></div>
                </button>
                <div class="audio-player-waveform">
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                    <div class="wave-bar"></div>
                </div>
            </div>
            <div class="audio-player-details">
                <div class="audio-player-name">${filename}</div>
                <div class="audio-player-progress">
                    <span class="audio-player-time current">0:00</span>
                    <div class="audio-player-bar">
                        <div class="audio-player-bar-fill"></div>
                    </div>
                    <span class="audio-player-time duration">0:00</span>
                </div>
            </div>
            <div class="audio-player-volume">
                <button class="volume-btn" title="Mute">
                    <svg class="volume-icon-high" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                    <svg class="volume-icon-low" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                    </svg>
                    <svg class="volume-icon-mute" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    </svg>
                </button>
                <div class="volume-slider-container">
                    <div class="volume-slider-track">
                        <div class="volume-slider-fill"></div>
                    </div>
                    <div class="volume-slider-handle"></div>
                </div>
            </div>
            <a href="${safeFileUrl}" class="audio-player-download" download="${filename}" title="Download">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
            </a>
        </div>
    `;
}

/**
 * Initialize audio player event handlers
 */
function initAudioPlayer(card) {
    const fileUrl = card.dataset.fileUrl;
    const fileId = card.dataset.fileId;

    if (!fileUrl || !fileUrl.trim()) {
        card.classList.add('audio-player-unavailable');
        const playBtn = card.querySelector('.audio-player-play-btn-large');
        if (playBtn) {
            playBtn.disabled = true;
            playBtn.setAttribute('aria-disabled', 'true');
        }
        const downloadLink = card.querySelector('.audio-player-download');
        if (downloadLink) {
            downloadLink.removeAttribute('href');
            downloadLink.setAttribute('aria-disabled', 'true');
            downloadLink.addEventListener('click', (e) => e.preventDefault());
        }
        const durationTime = card.querySelector('.audio-player-time.duration');
        if (durationTime) durationTime.textContent = '--:--';
        return;
    }
    
    // Create audio element
    const audio = new Audio();
    audio.preload = 'metadata';
    
    // Validate URL before setting src to prevent "Invalid URI" errors
    try {
        if (fileUrl && fileUrl.trim()) {
            audio.src = fileUrl;
        } else {
            // Invalid URL - disable player and return
            console.warn('[AudioPlayer] Invalid file URL, disabling player:', fileUrl);
            card.classList.add('audio-player-unavailable');
            const playBtn = card.querySelector('.audio-player-play-btn-large');
            if (playBtn) {
                playBtn.disabled = true;
                playBtn.setAttribute('aria-disabled', 'true');
            }
            return;
        }
    } catch (e) {
        console.warn('[AudioPlayer] Error setting audio src:', e);
        card.classList.add('audio-player-unavailable');
        return;
    }
    
    // Get UI elements
    const playBtn = card.querySelector('.audio-player-play-btn-large');
    const playIconSvg = card.querySelector('.audio-player-play-icon-svg');
    const pauseIconSvg = card.querySelector('.audio-player-pause-icon-svg');
    const loading = card.querySelector('.audio-player-loading');
    const waveform = card.querySelector('.audio-player-waveform');
    const progressBar = card.querySelector('.audio-player-bar');
    const progressFill = card.querySelector('.audio-player-bar-fill');
    const currentTime = card.querySelector('.audio-player-time.current');
    const durationTime = card.querySelector('.audio-player-time.duration');
    
    // Get volume elements
    const volumeBtn = card.querySelector('.volume-btn');
    const volumeIconHigh = card.querySelector('.volume-icon-high');
    const volumeIconLow = card.querySelector('.volume-icon-low');
    const volumeIconMute = card.querySelector('.volume-icon-mute');
    const volumeSliderContainer = card.querySelector('.volume-slider-container');
    const volumeSliderFill = card.querySelector('.volume-slider-fill');
    const volumeSliderHandle = card.querySelector('.volume-slider-handle');
    
    // Store audio element
    audioPlayerInstances.set(fileId, { audio, card });
    
    // Audio events
    audio.addEventListener('loadedmetadata', () => {
        durationTime.textContent = formatAudioTime(audio.duration);
        card.classList.remove('loading');
    });
    
    audio.addEventListener('timeupdate', () => {
        const progress = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = progress + '%';
        currentTime.textContent = formatAudioTime(audio.currentTime);
    });
    
    audio.addEventListener('ended', () => {
        stopAudioPlayback(fileId);
    });
    
    audio.addEventListener('play', () => {
        card.classList.add('playing');
        waveform.classList.add('playing');
        playIconSvg.style.display = 'none';
        pauseIconSvg.style.display = 'block';
    });
    
    audio.addEventListener('pause', () => {
        if (!audio.ended) {
            card.classList.remove('playing');
            waveform.classList.remove('playing');
            playIconSvg.style.display = 'block';
            pauseIconSvg.style.display = 'none';
        }
    });
    
    audio.addEventListener('waiting', () => {
        card.classList.add('loading');
    });
    
    audio.addEventListener('canplay', () => {
        card.classList.remove('loading');
    });
    
    audio.addEventListener('error', (e) => {
        const error = audio.error;
        if (error) {
            // Media error codes: 1=aborted, 2=network, 3=decode, 4=src_not_supported
            if (error.code === 4 || !audio.currentSrc) {
                console.warn('[AudioPlayer] Invalid or unsupported audio source:', audio.currentSrc || 'empty');
            } else {
                console.warn('[AudioPlayer] Audio error:', error.code, error.message);
            }
        }
        card.classList.remove('loading');
        card.classList.add('audio-player-unavailable');
        playIconSvg.style.display = 'block';
        pauseIconSvg.style.display = 'none';
        if (playBtn) playBtn.disabled = true;
    });
    
    // Play/Pause button click
    playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audio.paused) {
            playAudio(fileId);
        } else {
            pauseAudio(fileId);
        }
    });
    
    // Progress bar click to seek
    progressBar.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        audio.currentTime = percentage * audio.duration;
    });
    
    // Initialize volume (default 25%)
    let currentVolume = 0.25;
    let isMuted = false;
    audio.volume = currentVolume;
    
    // Update volume icons and slider
    const updateVolumeUI = (vol) => {
        const percentage = vol * 100;
        volumeSliderFill.style.width = percentage + '%';
        volumeSliderHandle.style.left = percentage + '%';
        
        // Update icon based on volume level
        volumeIconHigh.style.display = vol > 0.5 ? 'block' : 'none';
        volumeIconLow.style.display = (vol > 0 && vol <= 0.5) ? 'block' : 'none';
        volumeIconMute.style.display = vol === 0 ? 'block' : 'none';
    };
    updateVolumeUI(currentVolume);
    
    // Volume button click - toggle mute
    volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isMuted = !isMuted;
        if (isMuted) {
            audio.volume = 0;
            volumeSliderFill.style.width = '0%';
            volumeSliderHandle.style.left = '0%';
            volumeIconHigh.style.display = 'none';
            volumeIconLow.style.display = 'none';
            volumeIconMute.style.display = 'block';
        } else {
            audio.volume = currentVolume;
            updateVolumeUI(currentVolume);
        }
    });
    
    // Volume slider drag
    let isDraggingVolume = false;
    
    const updateVolumeFromSlider = (clientX) => {
        const rect = volumeSliderContainer.getBoundingClientRect();
        const percentage = (clientX - rect.left) / rect.width;
        const clampedVolume = Math.max(0, Math.min(1, percentage));
        currentVolume = clampedVolume;
        audio.volume = clampedVolume;
        isMuted = false;
        updateVolumeUI(clampedVolume);
    };
    
    volumeSliderContainer.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isDraggingVolume = true;
        updateVolumeFromSlider(e.clientX);
        
        const onMouseMove = (moveEvent) => {
            if (isDraggingVolume) {
                updateVolumeFromSlider(moveEvent.clientX);
            }
        };
        
        const onMouseUp = () => {
            isDraggingVolume = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
    
    volumeSliderContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        updateVolumeFromSlider(e.clientX);
    });
    
    // Touch support
    volumeSliderContainer.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        isDraggingVolume = true;
        updateVolumeFromSlider(e.touches[0].clientX);
        
        const onTouchMove = (moveEvent) => {
            if (isDraggingVolume) {
                updateVolumeFromSlider(moveEvent.touches[0].clientX);
            }
        };
        
        const onTouchEnd = () => {
            isDraggingVolume = false;
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };
        
        document.addEventListener('touchmove', onTouchMove, { passive: true });
        document.addEventListener('touchend', onTouchEnd);
    }, { passive: true });
    
    // Click on card to play/pause (but not on volume controls)
    card.addEventListener('click', (e) => {
        if (e.target.closest('.audio-player-download')) return;
        if (e.target.closest('.audio-player-volume')) return;
        
        if (audio.paused) {
            playAudio(fileId);
        } else {
            pauseAudio(fileId);
        }
    });
}

/**
 * Play audio - stops any currently playing audio first
 */
function playAudio(fileId) {
    // Stop currently playing audio if different
    if (currentPlayingAudio && currentPlayingAudio !== fileId) {
        stopAudioPlayback(currentPlayingAudio);
    }
    
    const player = audioPlayerInstances.get(fileId);
    if (player) {
        player.audio.play()
            .then(() => {
                currentPlayingAudio = fileId;
            })
            .catch(err => {
                console.error('Failed to play audio:', err);
            });
    }
}

/**
 * Pause audio
 */
function pauseAudio(fileId) {
    const player = audioPlayerInstances.get(fileId);
    if (player) {
        player.audio.pause();
    }
}

/**
 * Stop audio playback
 */
function stopAudioPlayback(fileId) {
    const player = audioPlayerInstances.get(fileId);
    if (player) {
        player.audio.pause();
        player.audio.currentTime = 0;
        player.card.classList.remove('playing');
        
        const playIconSvg = player.card.querySelector('.audio-player-play-icon-svg');
        const pauseIconSvg = player.card.querySelector('.audio-player-pause-icon-svg');
        const waveform = player.card.querySelector('.audio-player-waveform');
        
        if (playIconSvg) playIconSvg.style.display = 'block';
        if (pauseIconSvg) pauseIconSvg.style.display = 'none';
        if (waveform) waveform.classList.remove('playing');
        
        player.card.querySelector('.audio-player-bar-fill').style.width = '0%';
        player.card.querySelector('.audio-player-time.current').textContent = '0:00';
    }
    
    if (currentPlayingAudio === fileId) {
        currentPlayingAudio = null;
    }
}

/**
 * Stop all audio playback
 */
function stopAllAudio() {
    if (currentPlayingAudio) {
        stopAudioPlayback(currentPlayingAudio);
    }
}

/**
 * Initialize all audio players in the document
 */
function initAllAudioPlayers() {
    cleanupDetachedAudioPlayers();

    document.querySelectorAll('.audio-player-card:not([data-initialized])').forEach(card => {
        card.dataset.initialized = 'true';
        initAudioPlayer(card);
    });
}

window.addEventListener('pagehide', () => {
    disposeAllAudioPlayers();
    clearAttachmentPreviewUrls();
    clearDropZonePreviewUrls();
}, { once: true });

// Listen for new messages and initialize audio players
document.addEventListener('DOMContentLoaded', () => {
    initAllAudioPlayers();
});

// Also export for manual initialization after message rendering
window.initAudioPlayers = initAllAudioPlayers;

// Export for use elsewhere
window.audioPlayer = {
    play: playAudio,
    pause: pauseAudio,
    stop: stopAudioPlayback,
    stopAll: stopAllAudio
};

// Экспорт для использования в main.js
window.attachments = {
    openAttachmentDialog,
    addAttachments,
    removeAttachment,
    clearAllAttachments,
    uploadAttachments,
    uploadAttachmentsWithProgress,
    renderMessageAttachments,
    openImageLightbox,
    closeImageLightbox,
    getAttachmentsToSend: () => attachmentsToSend,
    clearAttachments: () => {
        attachmentsToSend = [];
        renderAttachmentsPreviews();
    },
    validateFile,
    cancelUpload,
    formatFileSize,
    getFileTypeInfo,
    getFileTypeIcon
};

