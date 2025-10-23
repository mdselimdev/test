const API_BASE_URL = 'https://perspicacity.onrender.com';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const settingsModal = document.getElementById('settings-modal');
    const openSettingsBtn = document.getElementById('open-settings');
    const closeSettingsBtn = document.getElementById('close-settings');
    const saveSettingsBtn = document.getElementById('save-settings');
    const apiKeyInput = document.getElementById('api-key-input');
    const googleApiKeyInput = document.getElementById('google-api-key-input');
    const chatForm = document.getElementById('chat-form');
    const queryInput = document.getElementById('query-input');
    const chatMessages = document.getElementById('chat-messages');
    const workflowBtn = document.getElementById('workflow-btn');
    const workflowDropdown = document.getElementById('workflow-dropdown');
    const workflowIcon = workflowBtn.querySelector('.workflow-icon');
    const workflowOptions = document.querySelectorAll('.workflow-option');
    const sendBtn = document.getElementById('send-btn');
    const scrollToBottomBtn = document.getElementById('scroll-to-bottom');
    const inputBox = document.getElementById('input-box');

    let currentMode = 'search';
    let abortController = null;
    let sourcesMap = {};
    let allSourcesList = [];
    let allArticlesList = []; // ADD THIS
    let allBooksList = []; // ADD THIS
    let researchStepsList = [];
    let isGenerating = false;
    let wordCount = 0;
    let isUserScrolledUp = false;
    let currentStreamingDiv = null;
    let isStreamingStopped = false;
    let conversationCount = 0;

    // Set initial state: welcome screen visible, no scroll
    chatMessages.classList.add('has-welcome');

    loadSettings();

    chatMessages.addEventListener('scroll', () => {
        const scrollTop = chatMessages.scrollTop;
        const scrollHeight = chatMessages.scrollHeight;
        const clientHeight = chatMessages.clientHeight;

        // --- ADDED LOGIC ---
        // This is the key: we check if the user is more than 100px
        // away from the bottom. If they are, we set isUserScrolledUp to true.
        // If they scroll back to the bottom, we set it to false,
        // which re-enables the auto-scroll.
        if (scrollHeight - scrollTop - clientHeight > 100) {
            isUserScrolledUp = true;
        } else {
            isUserScrolledUp = false;
        }
        // --- END ADDED LOGIC ---

        // Only show if content is longer than screen
        if (scrollHeight <= clientHeight) {
            scrollToBottomBtn.classList.add('hidden');
            return;
        }

        // Find the last user message (last prompt)
        const lastUserMessage = Array.from(chatMessages.querySelectorAll('.message-user')).pop();

        if (lastUserMessage) {
            const headerHeight = document.querySelector('.chat-header').offsetHeight;
            const lastPromptTop = lastUserMessage.offsetTop;
            const userScrollPosition = scrollTop + headerHeight;

            // Show button only if user is above the last prompt
            if (userScrollPosition < lastPromptTop - 100) {
                scrollToBottomBtn.classList.remove('hidden');
            } else {
                scrollToBottomBtn.classList.add('hidden');
            }
        } else {
            // No messages yet, hide button
            scrollToBottomBtn.classList.add('hidden');
        }
    });


    scrollToBottomBtn.addEventListener('click', () => {
        const lastUserMessage = Array.from(chatMessages.querySelectorAll('.message-user')).pop();

        if (lastUserMessage) {
            const headerHeight = document.querySelector('.chat-header').offsetHeight;
            const targetPosition = lastUserMessage.offsetTop - headerHeight - 20;

            chatMessages.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });

    function scrollToMessage(messageElement) {
        setTimeout(() => {
            const headerHeight = document.querySelector('.chat-header').offsetHeight;
            const elementTop = messageElement.offsetTop;
            chatMessages.scrollTo({
                top: elementTop - headerHeight - 20,
                behavior: 'smooth'
            });
        }, 100);
    }

    function extractContextFromDOM(currentMessageDiv) {
        const context = [];
        let previousMessage = currentMessageDiv ? currentMessageDiv.previousElementSibling : null;

        while (previousMessage) {
            if (previousMessage.classList.contains('welcome-screen')) {
                break;
            }

            if (previousMessage.classList.contains('message')) {
                let role = 'user';
                let content = '';

                if (previousMessage.classList.contains('message-user')) {
                    role = 'user';
                    const contentDiv = previousMessage.querySelector('.message-content');
                    if (contentDiv) {
                        content = contentDiv.textContent.trim();
                    }
                } else if (previousMessage.classList.contains('message-assistant')) {
                    role = 'assistant';
                    const contentDiv = previousMessage.querySelector('.message-content');
                    if (contentDiv) {
                        const clone = contentDiv.cloneNode(true);

                        // --- FIX: Get content from the answer tab *before* removing it ---
                        const answerTab = clone.querySelector('.response-content');
                        content = answerTab ? answerTab.textContent.trim() : '';
                        // --- END FIX ---

                        const tabs = clone.querySelector('.response-tabs');
                        if (tabs) tabs.remove();
                        const tabContents = clone.querySelectorAll('.tab-content');
                        tabContents.forEach(tc => tc.remove());
                        const actions = clone.querySelector('.message-actions');
                        if (actions) actions.remove();
                        const steps = clone.querySelector('.research-steps');
                        if (steps) steps.remove();
                        const searchStatus = clone.querySelector('.search-status');
                        if (searchStatus) searchStatus.remove();
                        
                        // --- FIX: The 'content = clone.textContent.trim();' line is deleted
                        // as we already have the content. We just run the sanitizers.
                        content = content.replace(/\[\d+\]/g, '');
                        content = content.replace(/\s+/g, ' ').trim();
                        // --- END FIX ---
                    }
                }

                if (content) {
                    context.unshift({ role, content });
                }
            }

            previousMessage = previousMessage.previousElementSibling;
        }

        return context;
    }

    function updatePlaceholder() {
        if (conversationCount >= 1) {
            queryInput.placeholder = queryInput.dataset.followupPlaceholder;
        } else {
            queryInput.placeholder = queryInput.dataset.initialPlaceholder;
        }
    }

    updatePlaceholder();

    function updateSendButtonState() {
        if (isGenerating) return;
        const query = queryInput.value.trim();
        sendBtn.disabled = query.length === 0;
    }

    queryInput.addEventListener('input', updateSendButtonState);
    updateSendButtonState();

    queryInput.addEventListener('input', () => {
        queryInput.style.height = 'auto';
        queryInput.style.height = Math.min(queryInput.scrollHeight, 150) + 'px';
    });

    queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            const isMobile = window.innerWidth < 768;
            if (!isMobile) {
                e.preventDefault();
                if (isGenerating || queryInput.value.trim().length > 0) {
                    chatForm.dispatchEvent(new Event('submit'));
                }
            }
        }
    });

    document.addEventListener('click', (e) => {
        const userMessage = e.target.closest('.message-user');
        if (userMessage && !userMessage.classList.contains('editing')) {
            if (window.innerWidth < 768) {
                document.querySelectorAll('.message-user.active').forEach(msg => {
                    if (msg !== userMessage) msg.classList.remove('active');
                });
                userMessage.classList.toggle('active');
            }
        } else if (!e.target.closest('.user-message-actions')) {
            document.querySelectorAll('.message-user.active').forEach(msg => {
                msg.classList.remove('active');
            });
        }
    });

    workflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        workflowDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        workflowDropdown.classList.add('hidden');
    });

    workflowDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    workflowOptions.forEach(option => {
        option.addEventListener('click', () => {
            const mode = option.dataset.mode;
            currentMode = mode;
            const icon = option.querySelector('svg').cloneNode(true);
            workflowIcon.innerHTML = icon.innerHTML;
            workflowDropdown.classList.add('hidden');
            workflowOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');
        });
    });

    workflowOptions[0].classList.add('active');

    openSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });

    saveSettingsBtn.addEventListener('click', () => {
        saveSettings();
        settingsModal.classList.add('hidden');
        showNotification('Settings saved successfully!');
    });

    function setSendButtonState(generating) {
        isGenerating = generating;
        if (generating) {
            sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="1"></rect></svg>`;
            sendBtn.classList.add('stop-btn');
            sendBtn.disabled = false;
            sendBtn.style.display = 'flex';
        } else {
            sendBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
            sendBtn.classList.remove('stop-btn');
            updateSendButtonState();
        }
    }

    function stopGeneration() {
        console.log('Stop generation called');
        isStreamingStopped = true;
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    
        // NEW: If there's a current streaming div without action buttons, add them
        if (currentStreamingDiv) {
            const contentDiv = currentStreamingDiv.querySelector('.message-content');
            let answerTab = contentDiv?.querySelector('.response-content');
        
            // If response-content doesn't exist (stopped during spinner), create it
            if (!answerTab) {
                const query = currentStreamingDiv.dataset.query || '';
                const mode = currentStreamingDiv.dataset.mode || 'search';
            
                // Remove any status spinners
                const statusDiv = contentDiv.querySelector('.search-status');
                if (statusDiv) statusDiv.remove();
                
                // Remove any research steps
                const stepsDiv = contentDiv.querySelector('.research-steps');
                if (stepsDiv) stepsDiv.remove();
                
                // Create the tab structure
                const tabsContainer = document.createElement('div');
                tabsContainer.className = 'response-tabs';
            
                // --- CHANGE HERE ---
                // Set tab based on the mode that was running
                const activeTabName = (mode === 'research') ? 'research' : 'answer';
                const activeTabLabel = (mode === 'research') ? 'Research' : 'Answer';
                tabsContainer.innerHTML = `<button class="response-tab active" data-tab="${activeTabName}">${activeTabLabel}</button>`;
                // --- END CHANGE ---
            
                contentDiv.appendChild(tabsContainer);
            
                // Create the answer tab content
                answerTab = document.createElement('div');
                answerTab.className = 'tab-content response-content active';
                
                // --- CHANGE HERE ---
                answerTab.dataset.tab = activeTabName;
                // --- END CHANGE ---
            
                answerTab.innerHTML = '<p style="color: var(--text-secondary);">Generation stopped.</p>';
                contentDiv.appendChild(answerTab);
            
                // Add action buttons
                addActionButtons(answerTab, 'Generation stopped.', [], query, false);
            } else if (!answerTab.querySelector('.message-actions')) {
                // Response-content exists but no buttons yet
                const query = currentStreamingDiv.dataset.query || '';
            
                // Remove any status spinners
                const statusDiv = contentDiv.querySelector('.search-status');
                if (statusDiv) statusDiv.remove();
            
                // Add a stopped message if answer tab is empty
                if (!answerTab.textContent.trim()) {
                    answerTab.innerHTML = '<p style="color: var(--text-secondary);">Generation stopped.</p>';
                }
            
                // Add action buttons
                addActionButtons(answerTab, answerTab.textContent, [], query, false);
            }
        }
    
        setSendButtonState(false);
        showNotification('Generation stopped', 'error');
    }
    
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isGenerating) {
            stopGeneration();
            return;
        }
        const query = queryInput.value.trim();
        if (!query) return;
        if (abortController) abortController.abort();
        const apiKey = localStorage.getItem('gemini_api_key');
        const googleApiKey = localStorage.getItem('google_api_key');
        if (!apiKey) {
            showNotification('Please set your Gemini API key in settings', 'error');
            settingsModal.classList.remove('hidden');
            return;
        }
        if (!googleApiKey) {
            showNotification('Please set your Google API key in settings', 'error');
            settingsModal.classList.remove('hidden');
            return;
        }

        const welcomeScreen = document.querySelector('.welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.remove();
            // Enable scrolling after welcome screen is removed
            chatMessages.classList.remove('has-welcome');
        }

        // IMMEDIATELY: Switch to compact layout and change placeholder
        if (conversationCount === 0) {
            inputBox.classList.add('compact');
            conversationCount++;
            updatePlaceholder();
        }

        const usedMode = currentMode;
        const userMessageDiv = addMessage(query, 'user', usedMode);

        scrollToMessage(userMessageDiv);

        isUserScrolledUp = false;
        queryInput.value = '';
        queryInput.style.height = 'auto';
        updateSendButtonState();
        sourcesMap = {};
        allSourcesList = [];
        allArticlesList = []; // ADD THIS
        allBooksList = []; // ADD THIS
        researchStepsList = [];
        wordCount = 0;
        isStreamingStopped = false;
        abortController = new AbortController(); // <-- ADD THIS LINE
        setSendButtonState(true);

        const conversationHistory = extractContextFromDOM(userMessageDiv);

        if (usedMode === 'search') {
            handleSearchMode(apiKey, googleApiKey, query, conversationHistory);
        } else {
            handleResearchMode(apiKey, googleApiKey, query, conversationHistory);
        }
    });

    async function handleSearchMode(apiKey, googleApiKey, query, conversationHistory) {
        const messageDiv = addMessage('', 'assistant', 'search');
        messageDiv.dataset.query = query;
        messageDiv.dataset.mode = 'search';
        currentStreamingDiv = messageDiv;

        const contentDiv = messageDiv.querySelector('.message-content');
    
        let searchStatusDiv = null; 
        
        // --- NEW: Timeout logic ---
        let timeoutId = null;
        let didTimeout = false;
        timeoutId = setTimeout(() => {
            didTimeout = true;
            if (abortController) {
                abortController.abort(); // Trigger the abort
            }
        }, 8000); // --- CHANGED: 8-second timeout for cold start ---
        // --- END NEW ---

        const headers = {'Content-Type': 'application/json'};
        const body = JSON.stringify({
            api_key: apiKey,
            google_api_key: googleApiKey,
            query: query,
            conversation_history: conversationHistory
        });

        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers,
                body,
                signal: abortController.signal
            });

            const contentType = response.headers.get('content-type');
        
            if (contentType && contentType.includes('text/event-stream')) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    
                    // --- NEW: Server is alive, clear timeout on first read ---
                    clearTimeout(timeoutId);
                    // --- END NEW ---

                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === 'Stream finished.') continue;

                            try {
                                const result = JSON.parse(data);
                            
                                if (result.status) {
                                    if (!searchStatusDiv) {
                                        searchStatusDiv = document.createElement('div');
                                        searchStatusDiv.className = 'search-status';
                                        searchStatusDiv.innerHTML = '<div class="status-spinner"></div><span class="status-text"></span>';
                                        contentDiv.appendChild(searchStatusDiv);
                                    }
                                    const statusText = searchStatusDiv.querySelector('.status-text');
                                    if (statusText) {
                                        statusText.textContent = result.status;
                                    }
                                }
                            
                                if (result.final_answer) {
                                    if (searchStatusDiv) searchStatusDiv.remove();
                                
                                    if (result.sources) {
                                        allSourcesList = result.sources;
                                        result.sources.forEach((source, index) => {
                                            sourcesMap[index + 1] = source;
                                        });
                                    }
                                
                                    if (result.articles) {
                                        allArticlesList = result.articles;
                                    }
                                
                                    if (result.books) {
                                        allBooksList = result.books;
                                    }
                                
                                    await streamResponse(messageDiv, result.final_answer, result.sources, query, 'search', result.show_ask_scholar_button);
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (searchStatusDiv) searchStatusDiv.remove(); 
            
            let errorMessage;
            if ((error.name === 'AbortError' && didTimeout) || error.name === 'TypeError') {
                // --- CHANGED: Friendlier error message for timeout OR network error ---
                errorMessage = "I couldn't get a response from the server. It might be busy or just waking up. Please try sending your message again in a moment.";
                await streamResponse(messageDiv, errorMessage, [], query, 'search');
            } else if (error.name === 'AbortError') {
                // This was a user "Stop" click, do nothing
            } else {
                // Other general error
                errorMessage = error.message || 'I encountered an issue processing your request. Please try again.';
                await streamResponse(messageDiv, errorMessage, [], query, 'search');
            }
        } finally {
            clearTimeout(timeoutId);
            currentStreamingDiv = null;
            setSendButtonState(false);
        }
    }

    async function handleResearchMode(apiKey, googleApiKey, query, conversationHistory) {
        const messageDiv = addMessage('', 'assistant', 'research');
        messageDiv.dataset.query = query;
        messageDiv.dataset.mode = 'research';
        currentStreamingDiv = messageDiv;

        // --- NEW: Timeout logic ---
        let timeoutId = null;
        let didTimeout = false;
        timeoutId = setTimeout(() => {
            didTimeout = true;
            if (abortController) {
                abortController.abort(); // Trigger the abort
            }
        }, 8000); // --- CHANGED: 8-second timeout for cold start ---
        // --- END NEW ---

        try {
            const response = await fetch(`${API_BASE_URL}/research`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    api_key: apiKey,
                    google_api_key: googleApiKey,
                    conversation_history: conversationHistory
                }),
                signal: abortController.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'research-steps';
            messageDiv.querySelector('.message-content').appendChild(stepsContainer);
            let currentStepDiv = null;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                // --- NEW: Server is alive, clear timeout on first read ---
                clearTimeout(timeoutId);
                // --- END NEW ---

                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === 'Stream finished.') continue;

                        try {
                            const result = JSON.parse(data);
                            if (result.status) {
                                if (currentStepDiv) currentStepDiv.classList.add('completed');
                                currentStepDiv = addResearchStep(stepsContainer, result.status);
                                researchStepsList.push(result.status);
                                periodicScroll();
                            } else if (result.final_answer) {
                                stepsContainer.remove();
                                if (result.sources) {
                                    allSourcesList = result.sources;
                                    result.sources.forEach((source, index) => {
                                        sourcesMap[index + 1] = source;
                                    });
                                }
                                if (result.articles) {
                                    allArticlesList = result.articles;
                                }
                                if (result.books) {
                                    allBooksList = result.books;
                                }
                                await streamResponse(messageDiv, result.final_answer, result.sources, query, 'research', result.show_ask_scholar_button);
                            } else if (result.error) {
                                stepsContainer.remove();
                                const errorMessage = result.message || result.error || 'An error occurred during research.';
                                await streamResponse(messageDiv, errorMessage, [], query, 'research');
                                currentStreamingDiv = null;
                                setSendButtonState(false);
                            }
                        } catch (e) {
                            console.error('Error parsing JSON:', e);
                        }
                    }
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            const contentDiv = messageDiv.querySelector('.message-content');
            const stepsContainer = contentDiv.querySelector('.research-steps');
            if (stepsContainer) stepsContainer.remove();
            
            let errorMessage;
            if ((error.name === 'AbortError' && didTimeout) || error.name === 'TypeError') {
                // --- CHANGED: Friendlier error message for timeout OR network error ---
                errorMessage = "I couldn't get a response from the server. It might be busy or just waking up. Please try sending your message again in a moment.";
                await streamResponse(messageDiv, errorMessage, [], query, 'research');
            } else if (error.name === 'AbortError') {
                // This was a user "Stop" click, do nothing
            } else {
                // Other general error
                errorMessage = error.message || 'Connection error occurred. Please try again.';
                await streamResponse(messageDiv, errorMessage, [], query, 'research');
            }
        } finally {
            clearTimeout(timeoutId);
            currentStreamingDiv = null;
            setSendButtonState(false);
        }
    }

    function addMessage(content, role, modeOrLoadingType = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${role}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        if (role === 'user') {
            messageDiv.dataset.workflow = modeOrLoadingType || 'search';
            messageDiv.dataset.query = content;
            messageDiv.dataset.originalQuery = content;
            contentDiv.textContent = content;
            addUserActionButtons(messageDiv, content, modeOrLoadingType || 'search');
        } else if (modeOrLoadingType === 'search') {
            contentDiv.innerHTML = '';
        } else if (modeOrLoadingType === 'research') {
            contentDiv.innerHTML = '';
        } else {
            contentDiv.textContent = content;
        }
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        return messageDiv;
    }

    function addUserActionButtons(messageDiv, query, workflow) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'user-message-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'user-action-btn';
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.title = 'Copy';
        
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Get the parent message and read its current query
            const messageDiv = e.target.closest('.message-user');
            const currentQuery = messageDiv.dataset.query;
            copyUserQuery(currentQuery, copyBtn);
        });

        copyBtn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            // Get the parent message and read its current query
            const messageDiv = e.target.closest('.message-user');
            const currentQuery = messageDiv.dataset.query;
            copyUserQuery(currentQuery, copyBtn);
        });

        
        const editBtn = document.createElement('button');
        editBtn.className = 'user-action-btn';
        editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
        editBtn.title = 'Edit';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            enterEditMode(messageDiv);
        });

        editBtn.addEventListener('touchend', (e) => {
            e.stopPropagation();
            e.preventDefault();
            enterEditMode(messageDiv);
        });
        
        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(editBtn);
        messageDiv.appendChild(actionsDiv);
    }

    function copyUserQuery(query, button) {
        navigator.clipboard.writeText(query).then(() => {
            const originalHTML = button.innerHTML;
            button.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            button.classList.add('copied');
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            showNotification('Failed to copy', 'error');
        });
    }

    function enterEditMode(messageDiv) {
        const contentDiv = messageDiv.querySelector('.message-content');
        const currentQuery = messageDiv.dataset.query;
        const actionsDiv = messageDiv.querySelector('.user-message-actions');
        if (actionsDiv) actionsDiv.style.display = 'none';

        const editWrapper = document.createElement('div');
        editWrapper.className = 'edit-wrapper';
        const textarea = document.createElement('textarea');
        textarea.className = 'edit-textarea';
        textarea.value = currentQuery;
        textarea.rows = 1;

        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const isMobile = window.innerWidth < 768;
                if (!isMobile) {
                    e.preventDefault();
                    const newQuery = textarea.value.trim();
                    const isEmpty = newQuery.length === 0;
                    if (!isEmpty) {
                        confirmEdit(messageDiv, newQuery);
                    }
                }
            }
        });

        const editActionsDiv = document.createElement('div');
        editActionsDiv.className = 'edit-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'edit-action-btn cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => exitEditMode(messageDiv, currentQuery);

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'edit-action-btn confirm-btn';
        confirmBtn.textContent = 'Done';
        confirmBtn.onclick = () => confirmEdit(messageDiv, textarea.value.trim());

        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        });

        editActionsDiv.appendChild(cancelBtn);
        editActionsDiv.appendChild(confirmBtn);
        editWrapper.appendChild(textarea);
        editWrapper.appendChild(editActionsDiv);
        contentDiv.innerHTML = '';
        contentDiv.appendChild(editWrapper);
        textarea.focus();
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        messageDiv.classList.add('editing');
    }

    function exitEditMode(messageDiv, currentQuery) {
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.textContent = currentQuery;
        const actionsDiv = messageDiv.querySelector('.user-message-actions');
        if (actionsDiv) actionsDiv.style.display = 'flex';
        messageDiv.classList.remove('editing');
    }

    function confirmEdit(messageDiv, newQuery) {
        if (!newQuery) return;
        const currentQuery = messageDiv.dataset.query;

        if (newQuery === currentQuery) {
            exitEditMode(messageDiv, currentQuery);
            return;
        }

        messageDiv.dataset.query = newQuery;
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.textContent = newQuery;
        const actionsDiv = messageDiv.querySelector('.user-message-actions');
        if (actionsDiv) actionsDiv.style.display = 'flex';
        messageDiv.classList.remove('editing');

        const responseDiv = messageDiv.nextElementSibling;
        if (!responseDiv || !responseDiv.classList.contains('message-assistant')) {
            showNotification('Could not find response to regenerate', 'error');
            return;
        }

        scrollToMessage(messageDiv);

        const workflow = responseDiv.dataset.mode || messageDiv.dataset.workflow;
        regenerateWithNewQuery(responseDiv, newQuery, workflow);
    }

    function addResearchStep(container, text) {
        let cleanText = text;
        cleanText = cleanText.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
        cleanText = cleanText.replace(/\*\*([^*]+)\*\*\*/g, '$1');
        cleanText = cleanText.replace(/\*([^*]+)\*/g, '$1');
        cleanText = cleanText.replace(/_([^_]+)_/g, '$1');
        cleanText = cleanText.replace(/`([^`]+)`/g, '$1');
        cleanText = cleanText.replace(/["']/g, '');
        cleanText = cleanText.replace(/[#]+\s*/g, '');
        cleanText = cleanText.replace(/^\d+\.\s*/g, '');
        cleanText = cleanText.replace(/^[-*+]\s*/g, '');
        cleanText = cleanText.replace(/\[\d+\]/g, '');
        cleanText = cleanText.replace(/\s+/g, ' ').trim();

        const stepDiv = document.createElement('div');
        stepDiv.className = 'research-step';
        stepDiv.innerHTML = `<div class="step-icon"></div><div class="step-text">${cleanText}</div>`;
        container.appendChild(stepDiv);
        return stepDiv;
    }

    function periodicScroll() {
        // 1. If the user has scrolled up, do nothing. This gives them freedom.
        if (isUserScrolledUp) return; 
    
        // 2. If they are at the bottom, scroll to the new bottom.
        // This is called periodically (every 50 words or every research step)
        // ensuring the scroll follows the streaming text.
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: 'auto' // 'auto' is instant, 'smooth' can lag behind streaming
        });
    }

    async function streamResponse(messageDiv, text, sources, originalQuery, mode, showAskButton = false) {
        const contentDiv = messageDiv.querySelector('.message-content');
        contentDiv.innerHTML = '';

        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'response-tabs';

        // Build the tabs HTML dynamically
        let tabsHTML = '';
        if (mode === 'search') {
            tabsHTML += `<button class="response-tab active" data-tab="answer">Answer</button>`;
            if (allSourcesList && allSourcesList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="sources">Sources</button>`;
            }
            if (allArticlesList && allArticlesList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="articles">Articles</button>`;
            }
            if (allBooksList && allBooksList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="books">Books</button>`;
            }
        } else { // research mode
            tabsHTML += `<button class="response-tab active" data-tab="research">Research</button>`;
            if (allSourcesList && allSourcesList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="sources">Sources</button>`;
            }
            if (allArticlesList && allArticlesList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="articles">Articles</button>`;
            }
            if (allBooksList && allBooksList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="books">Books</button>`;
            }
            if (researchStepsList && researchStepsList.length > 0) {
                tabsHTML += `<button class="response-tab" data-tab="steps">Steps</button>`;
            }
        }
        tabsContainer.innerHTML = tabsHTML;

        const answerTabContent = document.createElement('div');
        answerTabContent.className = 'tab-content response-content active';
        answerTabContent.dataset.tab = mode === 'research' ? 'research' : 'answer';

        contentDiv.appendChild(tabsContainer);
        contentDiv.appendChild(answerTabContent);

        let sourcesTabContent = null;
        if (allSourcesList && allSourcesList.length > 0) {
            sourcesTabContent = document.createElement('div');
            sourcesTabContent.className = 'tab-content';
            sourcesTabContent.dataset.tab = 'sources';
            contentDiv.appendChild(sourcesTabContent);
        }
    
        // ADDED: Create Articles and Books tab content
        let articlesTabContent = null;
        if (allArticlesList && allArticlesList.length > 0) {
            articlesTabContent = document.createElement('div');
            articlesTabContent.className = 'tab-content';
            articlesTabContent.dataset.tab = 'articles';
            contentDiv.appendChild(articlesTabContent);
        }
    
        let booksTabContent = null;
        if (allBooksList && allBooksList.length > 0) {
            booksTabContent = document.createElement('div');
            booksTabContent.className = 'tab-content';
            booksTabContent.dataset.tab = 'books';
            contentDiv.appendChild(booksTabContent);
        }

        let stepsTabContent = null;
        if (mode === 'research' && researchStepsList && researchStepsList.length > 0) {
            stepsTabContent = document.createElement('div');
            stepsTabContent.className = 'tab-content';
            stepsTabContent.dataset.tab = 'steps';
            contentDiv.appendChild(stepsTabContent);
        }

        tabsContainer.querySelectorAll('.response-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(messageDiv, tab.dataset.tab));
        });

        let processedText = text.replace(/\n\nSources:\s*\[.*?\]\(.*?\).*$/s, '')
            .replace(/\n\n---\n\*This answer is AI-generated.*$/s, '')
            .replace(/This answer is AI-generated.*$/s, '');

        const htmlContent = marked.parse(processedText);
        const parsedHTML = htmlContent.replace(/\[(\d+)\]/g, (match, num) => {
            const source = sourcesMap[num];
            if (source) {
                return `<a href="${source.url}" target="_blank" rel="noopener" class="inline-citation" title="${source.title}">[${num}]</a>`;
            }
            return match;
        });
        const words = parsedHTML.split(' ');
        let currentHTML = '';
        wordCount = 0;
        for (let i = 0; i < words.length; i++) {
            if (isStreamingStopped) break;
            currentHTML += words[i] + ' ';
            answerTabContent.innerHTML = currentHTML;
            wordCount++;
            if (wordCount % 50 === 0) periodicScroll();
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        if (sourcesTabContent) {
            sourcesTabContent.innerHTML = renderSourcesGrid(allSourcesList);
        }
        // ADDED: Populate Articles and Books tabs
        if (articlesTabContent) {
            articlesTabContent.innerHTML = renderSourcesGrid(allArticlesList);
        }
        if (booksTabContent) {
            booksTabContent.innerHTML = renderSourcesGrid(allBooksList);
        }
        if (mode === 'research' && stepsTabContent) {
            stepsTabContent.innerHTML = renderStepsDisplay(researchStepsList);
        }
    
        addActionButtons(answerTabContent, processedText, sources, originalQuery, showAskButton);

        currentStreamingDiv = null;
        setSendButtonState(false);
    }

    function switchTab(messageDiv, tabName) {
        const contentDiv = messageDiv.querySelector('.message-content');

        contentDiv.querySelectorAll('.response-tab').forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        contentDiv.querySelectorAll('.tab-content').forEach(content => {
            if (content.dataset.tab === tabName) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    }

    // Replace showTabsForSearch
    function showTabsForSearch(messageDiv) {
        const contentDiv = messageDiv.querySelector('.message-content');
        const sourcesTabContent = contentDiv.querySelector('[data-tab="sources"]');
        if (sourcesTabContent) {
            sourcesTabContent.innerHTML = renderSourcesGrid(allSourcesList);
        }
        const articlesTabContent = contentDiv.querySelector('[data-tab="articles"]');
        if (articlesTabContent) {
            articlesTabContent.innerHTML = renderSourcesGrid(allArticlesList);
        }
        const booksTabContent = contentDiv.querySelector('[data-tab="books"]');
        if (booksTabContent) {
            booksTabContent.innerHTML = renderSourcesGrid(allBooksList);
        }
    }
    
    // Replace showTabsForResearch
    function showTabsForResearch(messageDiv) {
        const contentDiv = messageDiv.querySelector('.message-content');
        const sourcesTabContent = contentDiv.querySelector('[data-tab="sources"]');
        const stepsTabContent = contentDiv.querySelector('[data-tab="steps"]');
        const articlesTabContent = contentDiv.querySelector('[data-tab="articles"]');
        const booksTabContent = contentDiv.querySelector('[data-tab="books"]');
    
        if (sourcesTabContent) {
            sourcesTabContent.innerHTML = renderSourcesGrid(allSourcesList);
        }
        if (articlesTabContent) {
            articlesTabContent.innerHTML = renderSourcesGrid(allArticlesList);
        }
        if (booksTabContent) {
            booksTabContent.innerHTML = renderSourcesGrid(allBooksList);
        }
        if (stepsTabContent) {
            stepsTabContent.innerHTML = renderStepsDisplay(researchStepsList);
        }
    }
    
    function renderSourcesGrid(sources) {
        if (!sources || sources.length === 0) {
            return '<p style="color: var(--text-secondary); padding: 1rem;">No sources available.</p>';
        }

        const INITIAL_SHOW = 5;
        const showMore = sources.length > INITIAL_SHOW;
        const initialSources = sources.slice(0, INITIAL_SHOW);
        const remainingSources = sources.slice(INITIAL_SHOW);

        let html = '<div class="sources-grid">';

        initialSources.forEach((source, index) => {
            html += renderSourceCard(source, index);
        });

        if (showMore) {
            html += '<div class="remaining-sources hidden">';
            remainingSources.forEach((source, index) => {
                html += renderSourceCard(source, INITIAL_SHOW + index);
            });
            html += '</div>';
            html += `<button class="show-more-sources" onclick="toggleRemainingSourcesHandler(this)">Show more</button>`;
        }

        html += '</div>';
        return html;
    }

    function renderSourceCard(source, index) {
        const url = new URL(source.url);
        const domain = url.hostname.replace('www.', '');
        const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

        const title = source.title.length > 100 ? source.title.substring(0, 100) + '...' : source.title;
        const description = (source.text || source.description || '').substring(0, 150).trim() + '...';

        return `
            <a href="${source.url}" target="_blank" rel="noopener" class="source-card">
                <div class="source-card-header">
                    <img src="${favicon}" alt="${domain}" class="source-favicon" onerror="this.style.display='none'">
                    <span class="source-domain">${domain}</span>
                </div>
                <div class="source-title">${title}</div>
                ${description ? `<div class="source-description">${description}</div>` : ''}
            </a>
        `;
    }

    function renderStepsDisplay(steps) {
        if (!steps || steps.length === 0) {
            return '<p style="color: var(--text-secondary); padding: 1rem;">No research steps available.</p>';
        }

        let html = '<div class="research-steps-display">';
        steps.forEach((step, index) => {
            let cleanText = step.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
                .replace(/\*\*([^*]+)\*\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/_([^_]+)_/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/["']/g, '')
                .replace(/[#]+\s*/g, '')
                .replace(/^\d+\.\s*/g, '')
                .replace(/^[-*+]\s*/g, '')
                .replace(/\[\d+\]/g, '')
                .replace(/\s+/g, ' ').trim();

            html += `
                <div class="research-step-card">
                    <div class="step-text">${cleanText}</div>
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    window.toggleRemainingSourcesHandler = function(button) {
        const remainingDiv = button.previousElementSibling;
        remainingDiv.classList.remove('hidden');
        button.remove();
    };

    function addActionButtons(answerTabContent, markdownText, sources, originalQuery, showAskButton = false) {
        const existingActions = answerTabContent.querySelector('.message-actions');
        if (existingActions) return;

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';

        // Conditionally create and add the "Ask a Scholar" button
        if (showAskButton) {
            const askScholarBtn = document.createElement('a');
            askScholarBtn.className = 'action-btn ask-scholar-btn';
            askScholarBtn.title = 'Ask a Scholar at IslamQA.info';
            askScholarBtn.href = 'https://islamqa.info/en/ask';
            askScholarBtn.target = '_blank';
            askScholarBtn.rel = 'noopener noreferrer';
            askScholarBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
            actionsDiv.appendChild(askScholarBtn);
        }

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn copy-btn';
        copyBtn.title = 'Copy';
        copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        copyBtn.onclick = () => copyResponse(markdownText, sources, originalQuery, copyBtn);

        const regenBtn = document.createElement('button');
        regenBtn.className = 'action-btn regenerate-btn';
        regenBtn.title = 'Regenerate';
        regenBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
        regenBtn.onclick = () => showRegenerateDropdown(regenBtn, answerTabContent.closest('.message-content'));
        
        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(regenBtn);
        answerTabContent.appendChild(actionsDiv);
    }

    function copyResponse(markdownText, sources, originalQuery, button) {
        // Use the passed-in markdownText directly
        let cleanedMarkdown = markdownText.trim();

        let copyText = `${originalQuery}\n\n${cleanedMarkdown}\n\n`;

        if (sources && sources.length > 0) {
            copyText += 'Citations:\n';
            // Create a numbered list of sources
            sources.forEach((source, index) => {
                copyText += `[${index + 1}] ${source.url}\n`;
            });
        }

        navigator.clipboard.writeText(copyText).then(() => {
            const originalHTML = button.innerHTML;
            button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            button.classList.add('copied');
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            showNotification('Failed to copy', 'error');
        });
    }

    function showRegenerateDropdown(button, messageContent) {
        const messageDiv = messageContent.closest('.message-assistant');
        const existingDropdown = document.querySelector('.regenerate-dropdown');
        if (existingDropdown) existingDropdown.remove();
        const dropdown = document.createElement('div');
        dropdown.className = 'regenerate-dropdown';
        dropdown.innerHTML = `
            <div class="regenerate-option" data-mode="search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <span>Search</span>
            </div>
            <div class="regenerate-option" data-mode="research">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                </svg>
                <span>Research</span>
            </div>
        `;
        button.parentElement.style.position = 'relative';
        button.parentElement.appendChild(dropdown);
        const options = dropdown.querySelectorAll('.regenerate-option');
        options.forEach(option => {
            option.onclick = () => {
                const mode = option.dataset.mode;
                regenerateResponse(messageDiv, mode);
                dropdown.remove();
            };
        });
        setTimeout(() => {
            document.addEventListener('click', function closeDropdown(e) {
                if (!dropdown.contains(e.target) && e.target !== button) {
                    dropdown.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            });
        }, 0);
    }

    function regenerateResponse(messageDiv, newMode) {
        const query = messageDiv.dataset.query;
        if (!query) return;
        if (isGenerating) {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        }

        scrollToMessage(messageDiv);

        const contentDiv = messageDiv.querySelector('.message-content');
        while (contentDiv.firstChild) {
            contentDiv.removeChild(contentDiv.firstChild);
        }

        messageDiv.dataset.mode = newMode;
        sourcesMap = {};
        allSourcesList = [];
        allArticlesList = [];
        allBooksList = [];
        researchStepsList = [];
        wordCount = 0;
        isUserScrolledUp = false;
        currentStreamingDiv = messageDiv;
        isStreamingStopped = false;
        const apiKey = localStorage.getItem('gemini_api_key');
        const googleApiKey = localStorage.getItem('google_api_key');

        const conversationHistory = extractContextFromDOM(messageDiv);

        setSendButtonState(true);
        if (newMode === 'search') {
            handleSearchModeRegenerate(apiKey, googleApiKey, query, messageDiv, conversationHistory);
        } else {
            handleResearchModeRegenerate(apiKey, googleApiKey, query, messageDiv, conversationHistory);
        }
    }

    function regenerateWithNewQuery(responseDiv, newQuery, workflow) {
        if (isGenerating) {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        }
        const contentDiv = responseDiv.querySelector('.message-content');
        while (contentDiv.firstChild) {
            contentDiv.removeChild(contentDiv.firstChild);
        }
        responseDiv.dataset.query = newQuery;
        responseDiv.dataset.mode = workflow;
        sourcesMap = {};
        allSourcesList = [];
        allArticlesList = [];
        allBooksList = [];
        researchStepsList = [];
        wordCount = 0;
        isUserScrolledUp = false;
        currentStreamingDiv = responseDiv;
        isStreamingStopped = false;
        const apiKey = localStorage.getItem('gemini_api_key');
        const googleApiKey = localStorage.getItem('google_api_key');

        const conversationHistory = extractContextFromDOM(responseDiv);
        abortController = new AbortController();
        setSendButtonState(true);
        if (workflow === 'search') {
            handleSearchModeRegenerate(apiKey, googleApiKey, newQuery, responseDiv, conversationHistory);
        } else {
            handleResearchModeRegenerate(apiKey, googleApiKey, newQuery, responseDiv, conversationHistory);
        }
    }

    async function handleSearchModeRegenerate(apiKey, googleApiKey, query, messageDiv, conversationHistory) {
        const contentDiv = messageDiv.querySelector('.message-content');
        abortController = new AbortController();

        let searchStatusDiv = null;

        // --- NEW: Timeout logic ---
        let timeoutId = null;
        let didTimeout = false;
        timeoutId = setTimeout(() => {
            didTimeout = true;
            if (abortController) {
                abortController.abort(); // Trigger the abort
            }
        }, 8000); // --- CHANGED: 8-second timeout for cold start ---
        // --- END NEW ---

        const headers = {'Content-Type': 'application/json'};
        const body = JSON.stringify({
            api_key: apiKey,
            google_api_key: googleApiKey,
            query: query,
            conversation_history: conversationHistory
        });

        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers,
                body,
                signal: abortController.signal
            });

            const contentType = response.headers.get('content-type');
        
            if (contentType && contentType.includes('text/event-stream')) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();

                    // --- NEW: Server is alive, clear timeout on first read ---
                    clearTimeout(timeoutId);
                    // --- END NEW ---

                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === 'Stream finished.') continue;

                            try {
                                const result = JSON.parse(data);
                            
                                if (result.status) {
                                    if (!searchStatusDiv) {
                                        searchStatusDiv = document.createElement('div');
                                        searchStatusDiv.className = 'search-status';
                                        searchStatusDiv.innerHTML = '<div class="status-spinner"></div><span class="status-text"></span>';
                                        contentDiv.appendChild(searchStatusDiv);
                                    }
                                    const statusText = searchStatusDiv.querySelector('.status-text');
                                    if (statusText) {
                                        statusText.textContent = result.status;
                                    }
                                }
                            
                                if (result.final_answer) {
                                    if (searchStatusDiv) searchStatusDiv.remove();
                                
                                    if (result.sources) {
                                        allSourcesList = result.sources;
                                        result.sources.forEach((source, index) => {
                                            sourcesMap[index + 1] = source;
                                        });
                                    }
                                
                                    if (result.articles) {
                                        allArticlesList = result.articles;
                                    }
                                
                                    if (result.books) {
                                        allBooksList = result.books;
                                    }
                                
                                    await streamResponse(messageDiv, result.final_answer, result.sources, query, 'search', result.show_ask_scholar_button);
                                }
                            } catch (e) {
                                console.error('Error parsing JSON:', e);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (searchStatusDiv) searchStatusDiv.remove();
            
            let errorMessage;
            if ((error.name === 'AbortError' && didTimeout) || error.name === 'TypeError') {
                // --- CHANGED: Friendlier error message for timeout OR network error ---
                errorMessage = "I couldn't get a response from the server. It might be busy or just waking up. Please try sending your message again in a moment.";
                await streamResponse(messageDiv, errorMessage, [], query, 'search');
            } else if (error.name === 'AbortError') {
                // This was a user "Stop" click, do nothing
            } else {
                // Other general error
                errorMessage = error.message || 'I encountered an issue. Please try again.';
                await streamResponse(messageDiv, errorMessage, [], query, 'search');
            }
        } finally {
            clearTimeout(timeoutId);
            currentStreamingDiv = null;
            setSendButtonState(false);
            abortController = null;
        }
    }

    async function handleResearchModeRegenerate(apiKey, googleApiKey, query, messageDiv, conversationHistory) {
        abortController = new AbortController();
        
        // --- NEW: Timeout logic ---
        let timeoutId = null;
        let didTimeout = false;
        timeoutId = setTimeout(() => {
            didTimeout = true;
            if (abortController) {
                abortController.abort(); // Trigger the abort
            }
        }, 8000); // --- CHANGED: 8-second timeout for cold start ---
        // --- END NEW ---
        
        try {
            const response = await fetch(`${API_BASE_URL}/research`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    api_key: apiKey,
                    google_api_key: googleApiKey,
                    conversation_history: conversationHistory
                }),
                signal: abortController.signal
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const contentDiv = messageDiv.querySelector('.message-content');
            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'research-steps';
            contentDiv.appendChild(stepsContainer);
            let currentStepDiv = null;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                // --- NEW: Server is alive, clear timeout on first read ---
                clearTimeout(timeoutId);
                // --- END NEW ---

                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === 'Stream finished.') continue;

                        try {
                            const result = JSON.parse(data);
                            if (result.status) {
                                if (currentStepDiv) currentStepDiv.classList.add('completed');
                                currentStepDiv = addResearchStep(stepsContainer, result.status);
                                researchStepsList.push(result.status);
                                periodicScroll();
                            } else if (result.final_answer) {
                                stepsContainer.remove();
                                if (result.sources) {
                                    allSourcesList = result.sources;
                                    result.sources.forEach((source, index) => {
                                        sourcesMap[index + 1] = source;
                                    });
                                }
                                if (result.articles) {
                                    allArticlesList = result.articles;
                                }
                                if (result.books) {
                                    allBooksList = result.books;
                                }
                                await streamResponse(messageDiv, result.final_answer, result.sources, query, 'research', result.show_ask_scholar_button);
                            } else if (result.error) {
                                stepsContainer.remove();
                                const errorMessage = result.message || result.error || 'An error occurred.';
                                await streamResponse(messageDiv, errorMessage, [], query, 'research');
                                currentStreamingDiv = null;
                                setSendButtonState(false);
                            }
                        } catch (e) {
                            console.error('Error parsing JSON:', e);
                        }
                    }
                }
            }
        } catch (error) {
            clearTimeout(timeoutId);
            const contentDiv = messageDiv.querySelector('.message-content');
            const stepsContainer = contentDiv.querySelector('.research-steps');
            if (stepsContainer) stepsContainer.remove();

            let errorMessage;
            if ((error.name === 'AbortError' && didTimeout) || error.name === 'TypeError') {
                // --- CHANGED: Friendlier error message for timeout OR network error ---
                errorMessage = "I couldn't get a response from the server. It might be busy or just waking up. Please try sending your message again in a moment.";
                await streamResponse(messageDiv, errorMessage, [], query, 'research');
            } else if (error.name === 'AbortError') {
                // This was a user "Stop" click, do nothing
            } else {
                // Other general error
                errorMessage = error.message || 'Connection error occurred. Please try again.';
                await streamResponse(messageDiv, errorMessage, [], query, 'research');
            }
        } finally {
            clearTimeout(timeoutId);
            currentStreamingDiv = null;
            setSendButtonState(false);
        }
    }

    function loadSettings() {
        const apiKey = localStorage.getItem('gemini_api_key');
        const googleApiKey = localStorage.getItem('google_api_key');
        if (apiKey) apiKeyInput.value = apiKey;
        if (googleApiKey) googleApiKeyInput.value = googleApiKey;
    }

    function saveSettings() {
        const apiKey = apiKeyInput.value.trim();
        const googleApiKey = googleApiKeyInput.value.trim();
        localStorage.setItem('gemini_api_key', apiKey);
        localStorage.setItem('google_api_key', googleApiKey);
    }

    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 1rem 1.5rem; border-radius: 12px; z-index: 9999; animation: slideUp 0.3s ease; background: ${type === 'error' ? 'var(--error-bg)' : 'var(--success-bg)'}; color: ${type === 'error' ? 'var(--error-text)' : 'var(--success-text)'}; border: 1px solid ${type === 'error' ? 'var(--error-text)' : 'var(--success-text)'};`;
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
});

// Lazy load service worker registration
if ('serviceWorker' in navigator && !sessionStorage.getItem('sw-registered')) {
    setTimeout(() => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(() => sessionStorage.setItem('sw-registered', 'true'))
            .catch(err => console.log('SW registration failed:', err));
    }, 3000);
                }
