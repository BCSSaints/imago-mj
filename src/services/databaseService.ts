// Database Service for Teen AI Platform
// Handles all database operations with proper error handling and logging

export class DatabaseService {
  constructor(private db: D1Database) {}

  // User management
  async createUser(userData: {
    id: string;
    email: string;
    name: string;
    role: 'parent' | 'teen';
    parentId?: string;
  }) {
    const { id, email, name, role, parentId } = userData;
    
    return await this.db.prepare(`
      INSERT INTO users (id, email, name, role, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, email, name, role, parentId || null).run();
  }

  async getUserByEmail(email: string) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE email = ? AND is_active = TRUE
    `).bind(email).first();
  }

  async getUserById(id: string) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE id = ? AND is_active = TRUE
    `).bind(id).first();
  }

  async getTeensByParent(parentId: string) {
    return await this.db.prepare(`
      SELECT * FROM users WHERE parent_id = ? AND role = 'teen' AND is_active = TRUE
    `).bind(parentId).all();
  }

  // Session management
  async createSession(sessionData: {
    id: string;
    userId: string;
    expiresAt: string;
  }) {
    const { id, userId, expiresAt } = sessionData;
    
    return await this.db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(id, userId, expiresAt).run();
  }

  async validateSession(sessionId: string) {
    return await this.db.prepare(`
      SELECT u.*, s.id as session_id
      FROM users u
      JOIN sessions s ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now') AND u.is_active = TRUE
    `).bind(sessionId).first();
  }

  async deleteExpiredSessions() {
    return await this.db.prepare(`
      DELETE FROM sessions WHERE expires_at < datetime('now')
    `).run();
  }

  // Parental controls
  async createOrUpdateParentalControls(controlsData: {
    id: string;
    parentId: string;
    teenId: string;
    theologicalPerspective: string;
    contentFilterLevel: string;
    allowedTopics: string;
    blockedKeywords: string;
    safetyAlertsEnabled: boolean;
    chatReviewRequired: boolean;
    voiceModeEnabled: boolean;
    dailyTimeLimit: number;
  }) {
    const {
      id, parentId, teenId, theologicalPerspective, contentFilterLevel,
      allowedTopics, blockedKeywords, safetyAlertsEnabled,
      chatReviewRequired, voiceModeEnabled, dailyTimeLimit
    } = controlsData;
    
    return await this.db.prepare(`
      INSERT OR REPLACE INTO parental_controls (
        id, parent_id, teen_id, theological_perspective, content_filter_level,
        allowed_topics, blocked_keywords, safety_alerts_enabled, 
        chat_review_required, voice_mode_enabled, daily_time_limit, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      id, parentId, teenId, theologicalPerspective, contentFilterLevel,
      allowedTopics, blockedKeywords, safetyAlertsEnabled,
      chatReviewRequired, voiceModeEnabled, dailyTimeLimit
    ).run();
  }

  async getParentalControls(parentId: string, teenId: string) {
    return await this.db.prepare(`
      SELECT * FROM parental_controls WHERE parent_id = ? AND teen_id = ?
    `).bind(parentId, teenId).first();
  }

  async getParentalControlsByTeen(teenId: string) {
    return await this.db.prepare(`
      SELECT * FROM parental_controls WHERE teen_id = ?
    `).bind(teenId).first();
  }

  // Custom GPTs
  async createCustomGPT(gptData: {
    id: string;
    parentId: string;
    name: string;
    description: string;
    systemPrompt: string;
    theologicalValues: string;
    educationalFocus: string;
    personalityTraits: string;
  }) {
    const {
      id, parentId, name, description, systemPrompt,
      theologicalValues, educationalFocus, personalityTraits
    } = gptData;
    
    return await this.db.prepare(`
      INSERT INTO custom_gpts (
        id, parent_id, name, description, system_prompt,
        theological_values, educational_focus, personality_traits
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, parentId, name, description, systemPrompt,
      theologicalValues, educationalFocus, personalityTraits
    ).run();
  }

  async getCustomGPTsByParent(parentId: string) {
    return await this.db.prepare(`
      SELECT * FROM custom_gpts WHERE parent_id = ? AND is_active = TRUE
      ORDER BY created_at DESC
    `).bind(parentId).all();
  }

  async getCustomGPTById(id: string) {
    return await this.db.prepare(`
      SELECT * FROM custom_gpts WHERE id = ? AND is_active = TRUE
    `).bind(id).first();
  }

  // Conversations
  async createConversation(conversationData: {
    id: string;
    teenId: string;
    customGptId: string;
    title: string;
  }) {
    const { id, teenId, customGptId, title } = conversationData;
    
    return await this.db.prepare(`
      INSERT INTO conversations (id, teen_id, custom_gpt_id, title)
      VALUES (?, ?, ?, ?)
    `).bind(id, teenId, customGptId, title).run();
  }

  async getConversationsByTeen(teenId: string) {
    return await this.db.prepare(`
      SELECT c.*, cg.name as gpt_name
      FROM conversations c
      JOIN custom_gpts cg ON c.custom_gpt_id = cg.id
      WHERE c.teen_id = ?
      ORDER BY c.updated_at DESC
    `).bind(teenId).all();
  }

  async getConversationsByParent(parentId: string) {
    return await this.db.prepare(`
      SELECT c.*, u.name as teen_name, cg.name as gpt_name
      FROM conversations c
      JOIN users u ON c.teen_id = u.id
      JOIN custom_gpts cg ON c.custom_gpt_id = cg.id
      WHERE u.parent_id = ?
      ORDER BY c.updated_at DESC
    `).bind(parentId).all();
  }

  async getConversationById(conversationId: string) {
    return await this.db.prepare(`
      SELECT c.*, cg.name as gpt_name, cg.system_prompt, cg.theological_values, cg.personality_traits
      FROM conversations c
      JOIN custom_gpts cg ON c.custom_gpt_id = cg.id
      WHERE c.id = ?
    `).bind(conversationId).first();
  }

  async updateConversationTimestamp(conversationId: string) {
    return await this.db.prepare(`
      UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
    `).bind(conversationId).run();
  }

  // Messages
  async createMessage(messageData: {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    audioUrl?: string;
    isFlagged?: boolean;
    flagReason?: string;
  }) {
    const {
      id, conversationId, role, content, audioUrl,
      isFlagged = false, flagReason = null
    } = messageData;
    
    return await this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, audio_url, is_flagged, flag_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, conversationId, role, content, audioUrl || null, isFlagged, flagReason).run();
  }

  async getMessagesByConversation(conversationId: string) {
    return await this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).bind(conversationId).all();
  }

  async getRecentMessagesByConversation(conversationId: string, limit: number = 20) {
    return await this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(conversationId, limit).all();
  }

  // Safety alerts
  async createSafetyAlert(alertData: {
    id: string;
    parentId: string;
    teenId: string;
    conversationId: string;
    messageId: string;
    alertType: string;
    alertReason: string;
  }) {
    const {
      id, parentId, teenId, conversationId, messageId, alertType, alertReason
    } = alertData;
    
    return await this.db.prepare(`
      INSERT INTO safety_alerts (id, parent_id, teen_id, conversation_id, message_id, alert_type, alert_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, parentId, teenId, conversationId, messageId, alertType, alertReason).run();
  }

  async getSafetyAlertsByParent(parentId: string) {
    return await this.db.prepare(`
      SELECT sa.*, u.name as teen_name, c.title as conversation_title
      FROM safety_alerts sa
      JOIN users u ON sa.teen_id = u.id
      JOIN conversations c ON sa.conversation_id = c.id
      WHERE sa.parent_id = ?
      ORDER BY sa.created_at DESC
    `).bind(parentId).all();
  }

  async markAlertAsRead(alertId: string, parentId: string) {
    return await this.db.prepare(`
      UPDATE safety_alerts SET is_read = TRUE WHERE id = ? AND parent_id = ?
    `).bind(alertId, parentId).run();
  }

  async getUnreadAlertCount(parentId: string) {
    const result = await this.db.prepare(`
      SELECT COUNT(*) as count FROM safety_alerts WHERE parent_id = ? AND is_read = FALSE
    `).bind(parentId).first();
    
    return result?.count || 0;
  }

  // Analytics and reporting
  async getConversationStats(teenId: string, days: number = 30) {
    return await this.db.prepare(`
      SELECT 
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(m.id) as total_messages,
        COUNT(CASE WHEN m.is_flagged = TRUE THEN 1 END) as flagged_messages,
        COUNT(CASE WHEN m.role = 'user' THEN 1 END) as user_messages,
        COUNT(CASE WHEN m.role = 'assistant' THEN 1 END) as ai_messages
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      WHERE c.teen_id = ? AND c.created_at >= datetime('now', '-${days} days')
    `).bind(teenId).first();
  }

  async getDailyUsageStats(teenId: string, date: string) {
    return await this.db.prepare(`
      SELECT 
        COUNT(m.id) as message_count,
        MIN(m.created_at) as first_message,
        MAX(m.created_at) as last_message
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.teen_id = ? AND DATE(m.created_at) = DATE(?)
    `).bind(teenId, date).first();
  }

  // Maintenance and cleanup
  async cleanupExpiredSessions() {
    return await this.db.prepare(`
      DELETE FROM sessions WHERE expires_at < datetime('now')
    `).run();
  }

  async getSystemStats() {
    const userStats = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN role = 'parent' THEN 1 END) as parent_count,
        COUNT(CASE WHEN role = 'teen' THEN 1 END) as teen_count
      FROM users WHERE is_active = TRUE
    `).first();

    const conversationStats = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_conversations,
        COUNT(CASE WHEN is_flagged = TRUE THEN 1 END) as flagged_conversations
      FROM conversations
    `).first();

    const messageStats = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(CASE WHEN is_flagged = TRUE THEN 1 END) as flagged_messages
      FROM messages
    `).first();

    return {
      users: userStats,
      conversations: conversationStats,
      messages: messageStats
    };
  }
}