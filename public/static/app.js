// Teen AI Platform - Frontend Application
class TeenAIApp {
  constructor() {
    this.currentUser = null;
    this.sessionId = localStorage.getItem('sessionId');
    this.currentView = 'login';
    this.currentConversation = null;
    this.conversations = [];
    this.customGpts = [];
    this.safetyAlerts = [];
    
    this.init();
  }

  async init() {
    // Check if user is already logged in
    if (this.sessionId) {
      try {
        await this.loadUserData();
        if (this.currentUser) {
          this.currentView = this.currentUser.role === 'parent' ? 'parent-dashboard' : 'teen-chat';
          this.render();
          return;
        }
      } catch (error) {
        console.error('Session validation failed:', error);
        localStorage.removeItem('sessionId');
        this.sessionId = null;
      }
    }
    
    this.render();
  }

  async apiCall(endpoint, options = {}) {
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionId && { 'Authorization': `Bearer ${this.sessionId}` }),
        ...options.headers
      }
    };

    const response = await axios(endpoint, config);
    return response.data;
  }

  async loadUserData() {
    // This would typically validate the session and get user info
    // For now, we'll simulate this
    const userData = localStorage.getItem('userData');
    if (userData) {
      this.currentUser = JSON.parse(userData);
    }
  }

  async login(email) {
    try {
      const result = await this.apiCall('/api/auth/login', {
        method: 'POST',
        data: { email }
      });

      if (result.success) {
        this.currentUser = result.user;
        this.sessionId = result.sessionId;
        localStorage.setItem('sessionId', this.sessionId);
        localStorage.setItem('userData', JSON.stringify(this.currentUser));
        
        this.currentView = this.currentUser.role === 'parent' ? 'parent-dashboard' : 'teen-chat';
        this.render();
        
        if (this.currentUser.role === 'teen') {
          await this.loadCustomGpts();
          await this.loadConversations();
        } else {
          await this.loadSafetyAlerts();
          await this.loadConversations();
        }
      } else {
        this.showError('Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showError('Login failed: ' + (error.response?.data?.error || error.message));
    }
  }

  async register(email, name, role, parentEmail = null) {
    try {
      const result = await this.apiCall('/api/auth/register', {
        method: 'POST',
        data: { email, name, role, parentEmail }
      });

      if (result.success) {
        this.currentUser = result.user;
        this.sessionId = result.sessionId;
        localStorage.setItem('sessionId', this.sessionId);
        localStorage.setItem('userData', JSON.stringify(this.currentUser));
        
        this.currentView = this.currentUser.role === 'parent' ? 'parent-dashboard' : 'teen-chat';
        this.render();
        
        if (role === 'parent') {
          // Show setup wizard for new parent
          this.currentView = 'gpt-setup';
          this.render();
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      this.showError('Registration failed: ' + (error.response?.data?.error || error.message));
    }
  }

  async loadCustomGpts() {
    try {
      this.customGpts = await this.apiCall('/api/custom-gpts');
    } catch (error) {
      console.error('Failed to load custom GPTs:', error);
    }
  }

  async loadConversations() {
    try {
      this.conversations = await this.apiCall('/api/conversations');
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }

  async loadSafetyAlerts() {
    try {
      this.safetyAlerts = await this.apiCall('/api/safety-alerts');
    } catch (error) {
      console.error('Failed to load safety alerts:', error);
    }
  }

  async startConversation(customGptId, firstMessage) {
    try {
      // Auto-generate title from first message
      const title = firstMessage.length > 50 ? 
        firstMessage.substring(0, 47) + '...' : 
        firstMessage;

      const result = await this.apiCall('/api/conversations', {
        method: 'POST',
        data: { customGptId, title }
      });

      if (result.success) {
        this.currentConversation = {
          id: result.id,
          title,
          customGptId,
          messages: []
        };
        this.currentView = 'chat';
        this.render();
        
        // Immediately send the first message
        await this.sendMessage(firstMessage);
      }
    } catch (error) {
      console.error('Failed to start conversation:', error);
      this.showError('Failed to start conversation');
    }
  }

  async sendMessage(content) {
    if (!this.currentConversation) return;

    try {
      // Add user message to UI immediately
      const userMessage = {
        role: 'user',
        content,
        created_at: new Date().toISOString()
      };
      this.currentConversation.messages.push(userMessage);
      this.renderChat();

      // Send to API
      const result = await this.apiCall(`/api/conversations/${this.currentConversation.id}/messages`, {
        method: 'POST',
        data: { content }
      });

      if (result.success) {
        // Replace user message with server version and add AI response
        this.currentConversation.messages.pop(); // Remove temporary message
        this.currentConversation.messages.push({
          ...result.userMessage,
          role: 'user',
          created_at: new Date().toISOString()
        });
        this.currentConversation.messages.push({
          ...result.aiMessage,
          role: 'assistant',
          created_at: new Date().toISOString()
        });
        this.renderChat();

        // Speak the AI response if voice mode is available (but only if user initiated voice mode)
        if (voiceMode && voiceMode.synthesis && voiceMode.shouldSpeak) {
          voiceMode.speak(result.aiMessage.content);
        }

        if (result.userMessage.isFlagged) {
          this.showWarning('Your message has been flagged for review. A parent will be notified.');
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showError('Failed to send message');
      // Remove the temporary message
      this.currentConversation.messages.pop();
      this.renderChat();
    }
  }

  async loadConversationMessages(conversationId) {
    try {
      const messages = await this.apiCall(`/api/conversations/${conversationId}/messages`);
      this.currentConversation.messages = messages;
      this.renderChat();
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  logout() {
    localStorage.removeItem('sessionId');
    localStorage.removeItem('userData');
    this.currentUser = null;
    this.sessionId = null;
    this.currentView = 'login';
    this.render();
  }

  showError(message) {
    // Simple error display - could be enhanced with better UI
    alert('Error: ' + message);
  }

  showWarning(message) {
    alert('Warning: ' + message);
  }

  render() {
    const app = document.getElementById('app');
    
    switch (this.currentView) {
      case 'login':
        app.innerHTML = this.renderLogin();
        break;
      case 'register':
        app.innerHTML = this.renderRegister();
        break;
      case 'parent-dashboard':
        app.innerHTML = this.renderParentDashboard();
        break;
      case 'teen-chat':
        app.innerHTML = this.renderTeenDashboard();
        break;
      case 'chat':
        app.innerHTML = this.renderChat();
        break;
      case 'gpt-setup':
        app.innerHTML = this.renderGptSetup();
        break;
      default:
        app.innerHTML = this.renderLogin();
    }
    
    // Remove loading indicator
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
    
    this.attachEventListeners();
  }

  renderLogin() {
    return `
      <div class="glass-card rounded-2xl p-8 w-full max-w-md">
        <div class="text-center mb-8">
          <i class="fas fa-shield-heart text-4xl text-white mb-4"></i>
          <h1 class="text-3xl font-bold text-white mb-2">Teen AI Platform</h1>
          <p class="text-gray-200">Safe AI conversations for Christian families</p>
        </div>
        
        <form id="loginForm" class="space-y-6">
          <div>
            <label class="block text-white text-sm font-medium mb-2">Email Address</label>
            <input type="email" id="email" required 
                   class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                   placeholder="Enter your email">
          </div>
          
          <button type="submit" 
                  class="w-full bg-white text-purple-600 py-3 rounded-lg font-semibold hover:bg-gray-100 transition duration-200">
            <i class="fas fa-sign-in-alt mr-2"></i>Sign In
          </button>
        </form>
        
        <div class="mt-6 text-center">
          <p class="text-gray-200 text-sm mb-4">Don't have an account?</p>
          <button onclick="app.currentView='register'; app.render()" 
                  class="text-white underline hover:text-gray-200">
            Create Account
          </button>
        </div>
      </div>
    `;
  }

  renderRegister() {
    return `
      <div class="glass-card rounded-2xl p-8 w-full max-w-md">
        <div class="text-center mb-8">
          <i class="fas fa-user-plus text-4xl text-white mb-4"></i>
          <h1 class="text-3xl font-bold text-white mb-2">Create Account</h1>
          <p class="text-gray-200">Join our safe AI community</p>
        </div>
        
        <form id="registerForm" class="space-y-6">
          <div>
            <label class="block text-white text-sm font-medium mb-2">Full Name</label>
            <input type="text" id="name" required 
                   class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                   placeholder="Enter your full name">
          </div>
          
          <div>
            <label class="block text-white text-sm font-medium mb-2">Email Address</label>
            <input type="email" id="email" required 
                   class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                   placeholder="Enter your email">
          </div>
          
          <div>
            <label class="block text-white text-sm font-medium mb-2">Account Type</label>
            <select id="role" required onchange="toggleParentEmail()"
                    class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white focus:outline-none focus:ring-2 focus:ring-white/50">
              <option value="">Select account type</option>
              <option value="parent">Parent/Guardian</option>
              <option value="teen">Teen (13-18)</option>
            </select>
          </div>
          
          <div id="parentEmailField" style="display: none;">
            <label class="block text-white text-sm font-medium mb-2">Parent's Email</label>
            <input type="email" id="parentEmail"
                   class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                   placeholder="Enter your parent's email">
            <p class="text-gray-300 text-xs mt-1">Your parent must already have an account</p>
          </div>
          
          <button type="submit" 
                  class="w-full bg-white text-purple-600 py-3 rounded-lg font-semibold hover:bg-gray-100 transition duration-200">
            <i class="fas fa-user-plus mr-2"></i>Create Account
          </button>
        </form>
        
        <div class="mt-6 text-center">
          <button onclick="app.currentView='login'; app.render()" 
                  class="text-white underline hover:text-gray-200">
            Already have an account? Sign In
          </button>
        </div>
      </div>
      
      <script>
        function toggleParentEmail() {
          const role = document.getElementById('role').value;
          const parentEmailField = document.getElementById('parentEmailField');
          const parentEmailInput = document.getElementById('parentEmail');
          
          if (role === 'teen') {
            parentEmailField.style.display = 'block';
            parentEmailInput.required = true;
          } else {
            parentEmailField.style.display = 'none';
            parentEmailInput.required = false;
          }
        }
      </script>
    `;
  }

  renderParentDashboard() {
    const unreadAlerts = this.safetyAlerts.filter(alert => !alert.is_read).length;
    
    return `
      <div class="min-h-screen p-4">
        <div class="max-w-6xl mx-auto">
          <!-- Header -->
          <div class="glass-card rounded-2xl p-6 mb-6">
            <div class="flex justify-between items-center">
              <div>
                <h1 class="text-2xl font-bold text-white mb-2">Parent Dashboard</h1>
                <p class="text-gray-200">Welcome back, ${this.currentUser.name}</p>
              </div>
              <button onclick="app.logout()" 
                      class="bg-red-500/20 text-white px-4 py-2 rounded-lg hover:bg-red-500/30 transition">
                <i class="fas fa-sign-out-alt mr-2"></i>Logout
              </button>
            </div>
          </div>

          <!-- Stats Cards -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div class="glass-card rounded-xl p-6">
              <div class="flex items-center">
                <div class="bg-blue-500/20 p-3 rounded-lg mr-4">
                  <i class="fas fa-comments text-2xl text-blue-300"></i>
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-white">Conversations</h3>
                  <p class="text-2xl font-bold text-white">${this.conversations.length}</p>
                </div>
              </div>
            </div>
            
            <div class="glass-card rounded-xl p-6">
              <div class="flex items-center">
                <div class="bg-yellow-500/20 p-3 rounded-lg mr-4">
                  <i class="fas fa-exclamation-triangle text-2xl text-yellow-300"></i>
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-white">Safety Alerts</h3>
                  <p class="text-2xl font-bold text-white">${unreadAlerts}</p>
                </div>
              </div>
            </div>
            
            <div class="glass-card rounded-xl p-6">
              <div class="flex items-center">
                <div class="bg-green-500/20 p-3 rounded-lg mr-4">
                  <i class="fas fa-robot text-2xl text-green-300"></i>
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-white">Custom GPTs</h3>
                  <p class="text-2xl font-bold text-white">${this.customGpts.length}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Main Content -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Recent Conversations -->
            <div class="glass-card rounded-xl p-6">
              <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-white">Recent Conversations</h2>
                <button onclick="app.currentView='conversations-review'; app.render()" 
                        class="text-blue-300 hover:text-blue-200">
                  <i class="fas fa-eye mr-1"></i>View All
                </button>
              </div>
              
              ${this.conversations.length > 0 ? `
                <div class="space-y-3">
                  ${this.conversations.slice(0, 5).map(conv => `
                    <div class="bg-white/10 rounded-lg p-4">
                      <div class="flex justify-between items-start">
                        <div>
                          <h4 class="font-medium text-white">${conv.title}</h4>
                          <p class="text-sm text-gray-300">${conv.teen_name || 'Unknown Teen'}</p>
                          <p class="text-xs text-gray-400">${new Date(conv.created_at).toLocaleDateString()}</p>
                        </div>
                        ${conv.is_flagged ? '<i class="fas fa-flag text-red-400"></i>' : ''}
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <p class="text-gray-300 text-center py-8">No conversations yet</p>
              `}
            </div>

            <!-- Safety Alerts -->
            <div class="glass-card rounded-xl p-6">
              <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-white">Safety Alerts</h2>
                <span class="bg-red-500 text-white text-xs px-2 py-1 rounded-full">${unreadAlerts}</span>
              </div>
              
              ${this.safetyAlerts.length > 0 ? `
                <div class="space-y-3">
                  ${this.safetyAlerts.slice(0, 5).map(alert => `
                    <div class="bg-white/10 rounded-lg p-4 ${!alert.is_read ? 'border-l-4 border-red-400' : ''}">
                      <div class="flex justify-between items-start">
                        <div>
                          <h4 class="font-medium text-white">${alert.alert_type.replace('_', ' ').toUpperCase()}</h4>
                          <p class="text-sm text-gray-300">${alert.teen_name}</p>
                          <p class="text-xs text-gray-400">${alert.alert_reason}</p>
                          <p class="text-xs text-gray-400">${new Date(alert.created_at).toLocaleDateString()}</p>
                        </div>
                        ${!alert.is_read ? `
                          <button onclick="markAlertRead('${alert.id}')" 
                                  class="text-blue-300 hover:text-blue-200 text-sm">
                            Mark Read
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <p class="text-gray-300 text-center py-8">No safety alerts</p>
              `}
            </div>
          </div>

          <!-- Quick Actions -->
          <div class="glass-card rounded-xl p-6 mt-6">
            <h2 class="text-xl font-semibold text-white mb-4">Quick Actions</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <button onclick="app.currentView='gpt-setup'; app.render()" 
                      class="bg-blue-500/20 hover:bg-blue-500/30 text-white p-4 rounded-lg transition text-center">
                <i class="fas fa-robot text-2xl mb-2"></i>
                <div class="text-sm font-medium">Create Custom GPT</div>
              </button>
              
              <button onclick="app.currentView='parental-controls'; app.render()" 
                      class="bg-purple-500/20 hover:bg-purple-500/30 text-white p-4 rounded-lg transition text-center">
                <i class="fas fa-shield-alt text-2xl mb-2"></i>
                <div class="text-sm font-medium">Parental Controls</div>
              </button>
              
              <button onclick="app.currentView='conversations-review'; app.render()" 
                      class="bg-green-500/20 hover:bg-green-500/30 text-white p-4 rounded-lg transition text-center">
                <i class="fas fa-eye text-2xl mb-2"></i>
                <div class="text-sm font-medium">Review Chats</div>
              </button>
              
              <button onclick="app.currentView='safety-alerts'; app.render()" 
                      class="bg-red-500/20 hover:bg-red-500/30 text-white p-4 rounded-lg transition text-center">
                <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
                <div class="text-sm font-medium">Safety Alerts</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderTeenDashboard() {
    return `
      <div class="min-h-screen p-4">
        <div class="max-w-4xl mx-auto">
          <!-- Header -->
          <div class="glass-card rounded-2xl p-6 mb-6">
            <div class="flex justify-between items-center">
              <div>
                <h1 class="text-2xl font-bold text-white mb-2">Welcome, ${this.currentUser.name}!</h1>
                <p class="text-gray-200">Choose an AI assistant to start learning</p>
              </div>
              <button onclick="app.logout()" 
                      class="bg-red-500/20 text-white px-4 py-2 rounded-lg hover:bg-red-500/30 transition">
                <i class="fas fa-sign-out-alt mr-2"></i>Logout
              </button>
            </div>
          </div>

          <!-- Available AI Assistants -->
          <div class="glass-card rounded-xl p-6 mb-6">
            <h2 class="text-xl font-semibold text-white mb-4">Your AI Assistants</h2>
            
            ${this.customGpts.length > 0 ? `
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${this.customGpts.map(gpt => `
                  <div class="bg-white/10 rounded-lg p-4 hover:bg-white/20 transition cursor-pointer"
                       onclick="startNewConversation('${gpt.id}', '${gpt.name}')">
                    <div class="flex items-center mb-3">
                      <div class="bg-purple-500/20 p-3 rounded-lg mr-4">
                        <i class="fas fa-robot text-xl text-purple-300"></i>
                      </div>
                      <div>
                        <h3 class="font-semibold text-white">${gpt.name}</h3>
                        <p class="text-sm text-gray-300">${gpt.description || 'Your AI study companion'}</p>
                      </div>
                    </div>
                    <p class="text-xs text-gray-400">${gpt.personality_traits.split(',').map(trait => trait.charAt(0).toUpperCase() + trait.slice(1)).join(' • ')}</p>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="text-center py-8">
                <i class="fas fa-robot text-4xl text-gray-400 mb-4"></i>
                <p class="text-gray-300 mb-2">No AI assistants available yet</p>
                <p class="text-sm text-gray-400">Ask your parent to create custom AI assistants for you!</p>
              </div>
            `}
          </div>

          <!-- Recent Conversations -->
          ${this.conversations.length > 0 ? `
            <div class="glass-card rounded-xl p-6">
              <h2 class="text-xl font-semibold text-white mb-4">Recent Conversations</h2>
              <div class="space-y-3">
                ${this.conversations.map(conv => `
                  <div class="bg-white/10 rounded-lg p-4 hover:bg-white/20 transition cursor-pointer"
                       onclick="openConversation('${conv.id}', '${conv.title}', '${conv.custom_gpt_id}')">
                    <div class="flex justify-between items-center">
                      <div>
                        <h4 class="font-medium text-white">${conv.title}</h4>
                        <p class="text-sm text-gray-300">${conv.gpt_name}</p>
                        <p class="text-xs text-gray-400">${new Date(conv.updated_at).toLocaleDateString()}</p>
                      </div>
                      <i class="fas fa-chevron-right text-gray-400"></i>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderChat() {
    if (!this.currentConversation) return this.renderTeenDashboard();

    return `
      <div class="min-h-screen flex flex-col">
        <!-- Chat Header -->
        <div class="glass-card rounded-t-2xl p-4 border-b border-white/20">
          <div class="flex justify-between items-center">
            <div class="flex items-center">
              <button onclick="app.currentView='teen-chat'; app.render()" 
                      class="text-white hover:text-gray-200 mr-4">
                <i class="fas fa-arrow-left text-xl"></i>
              </button>
              <div>
                <h2 class="text-lg font-semibold text-white">${this.currentConversation.title}</h2>
                <p class="text-sm text-gray-300">AI Assistant</p>
              </div>
            </div>
            <button onclick="startVoiceMode()" 
                    class="bg-blue-500/20 hover:bg-blue-500/30 text-white px-4 py-2 rounded-lg transition">
              <i class="fas fa-microphone mr-2"></i>Voice
            </button>
          </div>
        </div>

        <!-- Chat Messages -->
        <div class="flex-1 glass-card rounded-none p-4 overflow-y-auto" id="chatMessages">
          ${this.currentConversation.messages.length > 0 ? `
            <div class="space-y-4 max-w-4xl mx-auto">
              ${this.currentConversation.messages.map(msg => `
                <div class="flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                  <div class="flex items-start max-w-xs md:max-w-md ${msg.role === 'user' ? 'flex-row-reverse' : ''}">
                    <div class="flex-shrink-0 ${msg.role === 'user' ? 'ml-3' : 'mr-3'}">
                      <div class="w-8 h-8 rounded-full flex items-center justify-center ${
                        msg.role === 'user' 
                          ? 'bg-blue-500' 
                          : 'bg-purple-500'
                      }">
                        <i class="fas fa-${msg.role === 'user' ? 'user' : 'robot'} text-white text-sm"></i>
                      </div>
                    </div>
                    <div class="flex-1">
                      <div class="rounded-lg p-3 ${
                        msg.role === 'user' 
                          ? 'bg-blue-500 text-white' 
                          : 'bg-white/20 text-white'
                      }">
                        <p class="text-sm">${msg.content}</p>
                        ${msg.is_flagged ? '<p class="text-xs mt-2 opacity-75"><i class="fas fa-flag mr-1"></i>Flagged for review</p>' : ''}
                      </div>
                      <p class="text-xs text-gray-400 mt-1 ${msg.role === 'user' ? 'text-right' : ''}">
                        ${new Date(msg.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `
            <div class="text-center py-12">
              <i class="fas fa-comments text-4xl text-gray-400 mb-4"></i>
              <p class="text-gray-300">Start your conversation! Ask me anything about your studies or life.</p>
            </div>
          `}
        </div>

        <!-- Chat Input -->
        <div class="glass-card rounded-b-2xl p-4 border-t border-white/20">
          <form id="chatForm" class="flex space-x-3">
            <input type="text" id="messageInput" 
                   class="flex-1 px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                   placeholder="Type your message..." required>
            <button type="submit" 
                    class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition">
              <i class="fas fa-paper-plane"></i>
            </button>
          </form>
        </div>
      </div>
    `;
  }

  renderGptSetup() {
    return `
      <div class="min-h-screen p-4">
        <div class="max-w-2xl mx-auto">
          <div class="glass-card rounded-2xl p-8">
            <div class="text-center mb-8">
              <i class="fas fa-robot text-4xl text-white mb-4"></i>
              <h1 class="text-3xl font-bold text-white mb-2">Create Custom AI Assistant</h1>
              <p class="text-gray-200">Design an AI tutor that reflects your family's values</p>
            </div>
            
            <form id="gptSetupForm" class="space-y-6">
              <div>
                <label class="block text-white text-sm font-medium mb-2">Assistant Name</label>
                <input type="text" id="gptName" required 
                       class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                       placeholder="e.g., Biblical Wisdom Tutor">
              </div>
              
              <div>
                <label class="block text-white text-sm font-medium mb-2">Description</label>
                <input type="text" id="gptDescription"
                       class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                       placeholder="Brief description of the assistant's purpose">
              </div>
              
              <div>
                <label class="block text-white text-sm font-medium mb-2">Personality Traits</label>
                <div class="grid grid-cols-2 gap-2 mb-3">
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="encouraging"> Encouraging
                  </label>
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="wise"> Wise
                  </label>
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="patient"> Patient
                  </label>
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="academically_rigorous"> Academically Rigorous
                  </label>
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="christ_centered"> Christ-Centered
                  </label>
                  <label class="flex items-center">
                    <input type="checkbox" class="personality-trait mr-2" value="helpful"> Helpful
                  </label>
                </div>
              </div>
              
              <div>
                <label class="block text-white text-sm font-medium mb-2">System Instructions</label>
                <textarea id="systemPrompt" rows="6" required
                          class="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white/50"
                          placeholder="Define how the AI should behave, what values to emphasize, and how to approach different topics..."></textarea>
                <p class="text-gray-300 text-xs mt-1">This is the most important part - be specific about your expectations and values.</p>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button type="submit" 
                        class="bg-white text-purple-600 py-3 rounded-lg font-semibold hover:bg-gray-100 transition duration-200">
                  <i class="fas fa-save mr-2"></i>Create Assistant
                </button>
                <button type="button" onclick="app.currentView='parent-dashboard'; app.render()"
                        class="bg-gray-500/20 text-white py-3 rounded-lg font-semibold hover:bg-gray-500/30 transition duration-200">
                  <i class="fas fa-times mr-2"></i>Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        await this.login(email);
      });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const role = document.getElementById('role').value;
        const parentEmail = document.getElementById('parentEmail')?.value || null;
        
        await this.register(email, name, role, parentEmail);
      });
    }

    // Chat form
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();
        
        if (content) {
          messageInput.value = '';
          await this.sendMessage(content);
        }
      });
    }

    // GPT Setup form
    const gptSetupForm = document.getElementById('gptSetupForm');
    if (gptSetupForm) {
      gptSetupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('gptName').value;
        const description = document.getElementById('gptDescription').value;
        const systemPrompt = document.getElementById('systemPrompt').value;
        
        const personalityTraits = Array.from(document.querySelectorAll('.personality-trait:checked'))
          .map(cb => cb.value).join(',');
        
        try {
          const result = await this.apiCall('/api/custom-gpts', {
            method: 'POST',
            data: {
              name,
              description,
              systemPrompt,
              personalityTraits
            }
          });
          
          if (result.success) {
            await this.loadCustomGpts();
            this.currentView = 'parent-dashboard';
            this.render();
          }
        } catch (error) {
          console.error('Failed to create GPT:', error);
          this.showError('Failed to create AI assistant');
        }
      });
    }
  }
}

// Global helper functions
function startNewConversation(customGptId, gptName) {
  const firstMessage = prompt(`What would you like to ask ${gptName}?`);
  if (firstMessage && firstMessage.trim()) {
    app.startConversation(customGptId, firstMessage.trim());
  }
}

function openConversation(conversationId, title, customGptId) {
  app.currentConversation = {
    id: conversationId,
    title,
    customGptId,
    messages: []
  };
  app.currentView = 'chat';
  app.render();
  app.loadConversationMessages(conversationId);
}

// Voice Mode Implementation
class VoiceMode {
  constructor() {
    this.isRecording = false;
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.currentVoice = null;
    this.shouldSpeak = false; // Only speak when user explicitly uses voice mode
    
    this.initializeSpeechRecognition();
    this.initializeSpeechSynthesis();
  }

  initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';
      
      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        this.handleSpeechResult(transcript);
      };
      
      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        this.stopRecording();
        app.showError('Voice recognition failed: ' + event.error);
      };
      
      this.recognition.onend = () => {
        this.stopRecording();
      };
    }
  }

  initializeSpeechSynthesis() {
    if ('speechSynthesis' in window) {
      // Wait for voices to load
      const loadVoices = () => {
        const voices = this.synthesis.getVoices();
        // Prefer female voices for a nurturing feel
        this.currentVoice = voices.find(voice => 
          voice.name.includes('Female') || 
          voice.name.includes('Samantha') ||
          voice.name.includes('Karen')
        ) || voices[0];
      };
      
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = loadVoices;
      } else {
        loadVoices();
      }
    }
  }

  startRecording() {
    if (!this.recognition) {
      app.showError('Voice recognition not supported in this browser');
      return false;
    }

    this.isRecording = true;
    this.updateVoiceButton(true);
    
    try {
      this.recognition.start();
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.stopRecording();
      return false;
    }
  }

  stopRecording() {
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
    }
    this.isRecording = false;
    this.updateVoiceButton(false);
  }

  handleSpeechResult(transcript) {
    console.log('Voice input:', transcript);
    
    // Set flag to speak responses when using voice input
    this.shouldSpeak = true;
    
    // Insert the transcript into the message input and submit
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.value = transcript;
      // Auto-submit the voice message
      const chatForm = document.getElementById('chatForm');
      if (chatForm) {
        chatForm.dispatchEvent(new Event('submit'));
      }
    }
  }

  speak(text) {
    if (!this.synthesis || !text) return;

    // Stop any current speech
    this.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    if (this.currentVoice) {
      utterance.voice = this.currentVoice;
    }
    
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    
    // Add some personality to the voice
    utterance.onstart = () => {
      console.log('AI speaking...');
    };
    
    utterance.onend = () => {
      console.log('AI finished speaking');
    };
    
    this.synthesis.speak(utterance);
  }

  updateVoiceButton(isRecording) {
    const voiceBtn = document.querySelector('[onclick="startVoiceMode()"]');
    if (voiceBtn) {
      if (isRecording) {
        voiceBtn.innerHTML = '<i class="fas fa-stop mr-2"></i>Stop';
        voiceBtn.className = voiceBtn.className.replace('bg-blue-500/20 hover:bg-blue-500/30', 'bg-red-500/20 hover:bg-red-500/30 recording');
      } else {
        voiceBtn.innerHTML = '<i class="fas fa-microphone mr-2"></i>Voice';
        voiceBtn.className = voiceBtn.className.replace('bg-red-500/20 hover:bg-red-500/30 recording', 'bg-blue-500/20 hover:bg-blue-500/30');
      }
    }
  }

  toggle() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      // Reset speak flag when starting new voice session
      this.shouldSpeak = false;
      this.startRecording();
    }
  }
}

// Initialize voice mode
const voiceMode = new VoiceMode();

function startVoiceMode() {
  voiceMode.toggle();
}

async function markAlertRead(alertId) {
  try {
    await app.apiCall(`/api/safety-alerts/${alertId}/mark-read`, {
      method: 'POST'
    });
    app.loadSafetyAlerts();
    app.render();
  } catch (error) {
    console.error('Failed to mark alert as read:', error);
  }
}

// Initialize the app
const app = new TeenAIApp();