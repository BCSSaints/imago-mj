import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { AIService } from './services/aiService'
import { DatabaseService } from './services/databaseService'

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  OPENAI_API_KEY?: string;
  JWT_SECRET?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend-backend communication
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// Utility functions
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

function generateEnhancedFallback(content: string, isFlagged: boolean = false): string {
  if (isFlagged) {
    return "I notice you might be going through something difficult. Remember that God loves you deeply, and there are people who care about you. If you're struggling, please talk to a trusted adult like your parents, a teacher, or a counselor. Is there something positive I can help you with instead?"
  }
  
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.includes('math') || lowerContent.includes('algebra') || lowerContent.includes('homework')) {
    return `I'd love to help you with your math studies! Mathematics beautifully reflects God's perfect order and design throughout creation. When we solve equations, we're discovering the logical relationships that God built into reality itself.

What specific math concept are you working on? Whether it's algebra, geometry, or another area, I'm here to walk through it step by step with you. Remember, Proverbs tells us that "the beginning of wisdom is the fear of the Lord" - and that includes using our minds to understand His mathematical design!

What particular problem or concept would you like to explore together?`;
  } else if (lowerContent.includes('bible') || lowerContent.includes('god') || lowerContent.includes('jesus') || lowerContent.includes('faith')) {
    return `What a wonderful question about faith! I'm excited to explore God's Word with you. The Bible is our ultimate source of truth and wisdom, and Jesus said "Ask and it will be given to you; seek and you will find; knock and the door will be opened to you" (Matthew 7:7).

God's Word has so much to teach us about life, character, and how to live in a way that honors Him. Whether you're curious about a specific Bible verse, want to understand a biblical principle, or are seeking guidance on how faith applies to your daily life, I'm here to help.

What specific aspect of faith or Scripture would you like to dive into together?`;
  } else if (lowerContent.includes('friend') || lowerContent.includes('relationship') || lowerContent.includes('social')) {
    return `Relationships and friendships are such an important part of life, and God has a lot to say about how we should treat others! The Bible teaches us to "love one another as I have loved you" (John 13:34) and to be the kind of friend we'd want to have ourselves.

Whether you're navigating friendship challenges, wondering how to be a better friend, or thinking about relationships in general, remember that God desires us to build connections that honor Him and help us grow in character.

What's on your heart about friendships or relationships? I'd love to help you think through it with biblical wisdom and practical guidance.`;
  } else if (lowerContent.includes('science') || lowerContent.includes('nature') || lowerContent.includes('creation')) {
    return `Science is amazing - it's one of the ways we get to explore and understand God's incredible creation! From the smallest atoms to the vastness of space, everything displays His wisdom, power, and creativity. As Psalm 19:1 says, "The heavens declare the glory of God; the skies proclaim the work of his hands."

Whether you're studying biology, chemistry, physics, or earth science, you're discovering the intricate designs and laws that God established. Science helps us understand HOW God's creation works, while the Bible tells us WHO created it and WHY.

What area of science are you curious about? I'd love to help you see both the scientific principles and the amazing way they point to our Creator!`;
  } else {
    return `I'm here to help you grow in wisdom and knowledge while keeping Christ at the center of our conversations! Whether you have questions about your studies, faith, relationships, or life in general, I want to provide guidance that's both practical and rooted in biblical truth.

God has given you a wonderful mind and heart, and I'm excited to explore whatever questions or topics you're thinking about. The Bible reminds us that "if any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you" (James 1:5).

What's on your mind today? What would you like to learn about or discuss?`;
  }
}

// Content filtering and safety functions
async function checkContentSafety(content: string, parentalControls: any): Promise<{ isSafe: boolean, reason?: string, alertType?: string }> {
  const lowerContent = content.toLowerCase()
  
  // Check for self-harm indicators
  const selfHarmKeywords = ['kill myself', 'suicide', 'end my life', 'hurt myself', 'cut myself', 'self harm']
  for (const keyword of selfHarmKeywords) {
    if (lowerContent.includes(keyword)) {
      return { isSafe: false, reason: `Self-harm language detected: "${keyword}"`, alertType: 'self_harm' }
    }
  }
  
  // Check for dangerous behavior
  const dangerKeywords = ['drugs', 'alcohol', 'running away', 'meeting strangers', 'inappropriate content']
  for (const keyword of dangerKeywords) {
    if (lowerContent.includes(keyword)) {
      return { isSafe: false, reason: `Dangerous content detected: "${keyword}"`, alertType: 'dangerous_behavior' }
    }
  }
  
  // Check blocked keywords from parental controls
  if (parentalControls.blocked_keywords) {
    const blockedKeywords = JSON.parse(parentalControls.blocked_keywords || '[]')
    for (const keyword of blockedKeywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return { isSafe: false, reason: `Blocked keyword detected: "${keyword}"`, alertType: 'blocked_keyword' }
      }
    }
  }
  
  return { isSafe: true }
}

async function sendSafetyAlert(db: D1Database, parentId: string, teenId: string, conversationId: string, messageId: string, alertType: string, reason: string) {
  const alertId = generateId()
  
  await db.prepare(`
    INSERT INTO safety_alerts (id, parent_id, teen_id, conversation_id, message_id, alert_type, alert_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(alertId, parentId, teenId, conversationId, messageId, alertType, reason).run()
}

// Authentication routes
app.post('/api/auth/register', async (c) => {
  const { env } = c
  const { email, name, role, parentEmail } = await c.req.json()
  
  if (!email || !name || !role) {
    return c.json({ error: 'Missing required fields' }, 400)
  }
  
  if (!isValidEmail(email)) {
    return c.json({ error: 'Invalid email format' }, 400)
  }
  
  if (role !== 'parent' && role !== 'teen') {
    return c.json({ error: 'Role must be parent or teen' }, 400)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const userId = generateId()
    let parentId = null
    
    if (role === 'teen') {
      if (!parentEmail) {
        return c.json({ error: 'Parent email required for teen accounts' }, 400)
      }
      
      const parent = await db.getUserByEmail(parentEmail)
      
      if (!parent || parent.role !== 'parent') {
        return c.json({ error: 'Parent account not found' }, 404)
      }
      
      parentId = parent.id
    }
    
    await db.createUser({
      id: userId,
      email,
      name,
      role,
      parentId
    })
    
    // Create session
    const sessionId = generateId()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30) // 30 days
    
    await db.createSession({
      id: sessionId,
      userId,
      expiresAt: expiresAt.toISOString()
    })
    
    return c.json({ 
      success: true, 
      user: { id: userId, email, name, role, parentId },
      sessionId 
    })
  } catch (error: any) {
    console.error('Registration error:', error)
    if (error.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Email already registered' }, 409)
    }
    return c.json({ error: 'Registration failed' }, 500)
  }
})

app.post('/api/auth/login', async (c) => {
  const { env } = c
  const { email } = await c.req.json()
  
  if (!email || !isValidEmail(email)) {
    return c.json({ error: 'Valid email required' }, 400)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.getUserByEmail(email)
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }
    
    // Create session
    const sessionId = generateId()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30) // 30 days
    
    await db.createSession({
      id: sessionId,
      userId: user.id as string,
      expiresAt: expiresAt.toISOString()
    })
    
    return c.json({ 
      success: true, 
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name, 
        role: user.role, 
        parentId: user.parent_id 
      },
      sessionId 
    })
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Login failed' }, 500)
  }
})

// Parental controls routes
app.get('/api/parental-controls/:teenId', async (c) => {
  const { env } = c
  const teenId = c.req.param('teenId')
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user) {
    return c.json({ error: 'Invalid session' }, 401)
  }
  
  if (user.role !== 'parent') {
    return c.json({ error: 'Parent access required' }, 403)
  }
  
  const controls = await env.DB.prepare(`
    SELECT * FROM parental_controls WHERE parent_id = ? AND teen_id = ?
  `).bind(user.id, teenId).first()
  
  if (!controls) {
    return c.json({ error: 'Parental controls not found' }, 404)
  }
  
  return c.json(controls)
})

app.post('/api/parental-controls', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user || user.role !== 'parent') {
    return c.json({ error: 'Parent access required' }, 403)
  }
  
  const { 
    teenId, 
    theologicalPerspective = 'conservative-christian',
    contentFilterLevel = 'strict',
    allowedTopics = [],
    blockedKeywords = [],
    safetyAlertsEnabled = true,
    chatReviewRequired = true,
    voiceModeEnabled = true,
    dailyTimeLimit = 120
  } = await c.req.json()
  
  if (!teenId) {
    return c.json({ error: 'Teen ID required' }, 400)
  }
  
  const controlsId = generateId()
  
  try {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO parental_controls (
        id, parent_id, teen_id, theological_perspective, content_filter_level,
        allowed_topics, blocked_keywords, safety_alerts_enabled, 
        chat_review_required, voice_mode_enabled, daily_time_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      controlsId, user.id, teenId, theologicalPerspective, contentFilterLevel,
      JSON.stringify(allowedTopics), JSON.stringify(blockedKeywords),
      safetyAlertsEnabled, chatReviewRequired, voiceModeEnabled, dailyTimeLimit
    ).run()
    
    return c.json({ success: true, id: controlsId })
  } catch (error) {
    return c.json({ error: 'Failed to save parental controls' }, 500)
  }
})

// Custom GPT routes
app.get('/api/custom-gpts', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user) {
      return c.json({ error: 'Invalid session' }, 401)
    }
    
    let parentId = user.id
    if (user.role === 'teen') {
      parentId = user.parent_id
    }
    
    const gpts = await db.getCustomGPTsByParent(parentId)
    return c.json(gpts.results || [])
  } catch (error) {
    console.error('Failed to get custom GPTs:', error)
    return c.json({ error: 'Failed to load AI assistants' }, 500)
  }
})

app.post('/api/custom-gpts', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user || user.role !== 'parent') {
      return c.json({ error: 'Parent access required' }, 403)
    }
    
    const { 
      name, 
      description, 
      systemPrompt, 
      theologicalValues = {},
      educationalFocus = [],
      personalityTraits = 'encouraging,wise,patient'
    } = await c.req.json()
    
    if (!name || !systemPrompt) {
      return c.json({ error: 'Name and system prompt required' }, 400)
    }
    
    const gptId = generateId()
    
    await db.createCustomGPT({
      id: gptId,
      parentId: user.id,
      name,
      description: description || '',
      systemPrompt,
      theologicalValues: JSON.stringify(theologicalValues),
      educationalFocus: JSON.stringify(educationalFocus),
      personalityTraits
    })
    
    return c.json({ success: true, id: gptId })
  } catch (error) {
    console.error('Failed to create custom GPT:', error)
    return c.json({ error: 'Failed to create custom GPT: ' + error.message }, 500)
  }
})

// Chat routes
app.get('/api/conversations', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user) {
      return c.json({ error: 'Invalid session' }, 401)
    }
    
    let conversations
    
    if (user.role === 'parent') {
      // Parents can see all conversations of their teens
      conversations = await db.getConversationsByParent(user.id)
    } else {
      // Teens can only see their own conversations
      conversations = await db.getConversationsByTeen(user.id)
    }
    
    return c.json(conversations.results || [])
  } catch (error) {
    console.error('Failed to get conversations:', error)
    return c.json({ error: 'Failed to load conversations' }, 500)
  }
})

app.post('/api/conversations', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user || user.role !== 'teen') {
      return c.json({ error: 'Teen access required' }, 403)
    }
    
    const { customGptId, title } = await c.req.json()
    
    if (!customGptId || !title) {
      return c.json({ error: 'Custom GPT ID and title required' }, 400)
    }
    
    // Verify the custom GPT exists and belongs to the teen's parent
    const customGpt = await db.getCustomGPTById(customGptId)
    if (!customGpt || customGpt.parent_id !== user.parent_id) {
      return c.json({ error: 'AI assistant not found or not authorized' }, 404)
    }
    
    const conversationId = generateId()
    
    await db.createConversation({
      id: conversationId,
      teenId: user.id,
      customGptId,
      title
    })
    
    return c.json({ success: true, id: conversationId })
  } catch (error) {
    console.error('Failed to create conversation:', error)
    return c.json({ error: 'Failed to create conversation: ' + error.message }, 500)
  }
})

app.get('/api/conversations/:conversationId/messages', async (c) => {
  const { env } = c
  const conversationId = c.req.param('conversationId')
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user) {
    return c.json({ error: 'Invalid session' }, 401)
  }
  
  // Verify user has access to this conversation
  let accessQuery = ''
  if (user.role === 'parent') {
    accessQuery = `
      SELECT c.* FROM conversations c
      JOIN users u ON c.teen_id = u.id
      WHERE c.id = ? AND u.parent_id = ?
    `
  } else {
    accessQuery = `
      SELECT * FROM conversations WHERE id = ? AND teen_id = ?
    `
  }
  
  const conversation = await env.DB.prepare(accessQuery).bind(conversationId, user.id).first()
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404)
  }
  
  const messages = await env.DB.prepare(`
    SELECT * FROM messages WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).bind(conversationId).all()
  
  return c.json(messages.results)
})

app.post('/api/conversations/:conversationId/messages', async (c) => {
  const { env } = c
  const conversationId = c.req.param('conversationId')
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const db = new DatabaseService(env.DB)
  const user = await db.validateSession(sessionId)
  
  if (!user || user.role !== 'teen') {
    return c.json({ error: 'Teen access required' }, 403)
  }
  
  const { content } = await c.req.json()
  
  if (!content) {
    return c.json({ error: 'Message content required' }, 400)
  }
  
  // Verify teen owns this conversation and get conversation details
  const conversation = await db.getConversationById(conversationId)
  
  if (!conversation || conversation.teen_id !== user.id) {
    return c.json({ error: 'Conversation not found' }, 404)
  }
  
  // Get parental controls
  const parentalControls = await db.getParentalControlsByTeen(user.id)
  
  if (!parentalControls) {
    return c.json({ error: 'Parental controls not configured' }, 400)
  }
  
  // Get conversation history for context
  const recentMessages = await db.getRecentMessagesByConversation(conversationId, 10)
  const conversationHistory = recentMessages.results?.reverse() || []
  
  const messageId = generateId()
  
  try {
    // Initialize AI service (use placeholder if no API key)
    let aiResponse;
    let isFlagged = false;
    let flagReason = null;
    let alertType = null;
    
    if (env.OPENAI_API_KEY) {
      // Use real AI service
      const aiService = new AIService(env.OPENAI_API_KEY);
      const aiResult = await aiService.generateResponse(
        content,
        {
          id: conversation.custom_gpt_id,
          name: conversation.gpt_name,
          system_prompt: conversation.system_prompt,
          theological_values: conversation.theological_values,
          personality_traits: conversation.personality_traits
        },
        parentalControls,
        conversationHistory
      );
      
      aiResponse = aiResult.content;
      isFlagged = !aiResult.isSafe;
      flagReason = aiResult.flagReason;
      alertType = aiResult.alertType;
    } else {
      // Fallback to simple content check and basic responses
      const safetyCheck = await checkContentSafety(content, parentalControls)
      
      if (!safetyCheck.isSafe) {
        isFlagged = true
        flagReason = safetyCheck.reason
        alertType = safetyCheck.alertType
      }
      
      // Generate enhanced AI response
      aiResponse = generateEnhancedFallback(content, isFlagged)
    }
    
    // Send safety alert to parent if needed
    if (isFlagged && parentalControls.safety_alerts_enabled && user.parent_id) {
      const alertId = generateId()
      await db.createSafetyAlert({
        id: alertId,
        parentId: user.parent_id,
        teenId: user.id,
        conversationId,
        messageId,
        alertType: alertType!,
        alertReason: flagReason!
      })
    }
    
    // Save user message
    await db.createMessage({
      id: messageId,
      conversationId,
      role: 'user',
      content,
      isFlagged,
      flagReason
    })
    
    // Save AI response
    const aiMessageId = generateId()
    await db.createMessage({
      id: aiMessageId,
      conversationId,
      role: 'assistant',
      content: aiResponse
    })
    
    // Update conversation timestamp
    await db.updateConversationTimestamp(conversationId)
    
    return c.json({ 
      success: true, 
      userMessage: { id: messageId, content, isFlagged },
      aiMessage: { id: aiMessageId, content: aiResponse }
    })
    
  } catch (error) {
    console.error('Error processing message:', error)
    return c.json({ error: 'Failed to process message' }, 500)
  }
})

// Safety alerts routes
app.get('/api/safety-alerts', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user || user.role !== 'parent') {
    return c.json({ error: 'Parent access required' }, 403)
  }
  
  const alerts = await env.DB.prepare(`
    SELECT sa.*, u.name as teen_name, c.title as conversation_title
    FROM safety_alerts sa
    JOIN users u ON sa.teen_id = u.id
    JOIN conversations c ON sa.conversation_id = c.id
    WHERE sa.parent_id = ?
    ORDER BY sa.created_at DESC
  `).bind(user.id).all()
  
  return c.json(alerts.results)
})

app.post('/api/safety-alerts/:alertId/mark-read', async (c) => {
  const { env } = c
  const alertId = c.req.param('alertId')
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user || user.role !== 'parent') {
    return c.json({ error: 'Parent access required' }, 403)
  }
  
  await env.DB.prepare(`
    UPDATE safety_alerts SET is_read = TRUE WHERE id = ? AND parent_id = ?
  `).bind(alertId, user.id).run()
  
  return c.json({ success: true })
})

// Analytics and dashboard routes
app.get('/api/analytics/dashboard/:teenId', async (c) => {
  const { env } = c
  const teenId = c.req.param('teenId')
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user || user.role !== 'parent') {
      return c.json({ error: 'Parent access required' }, 403)
    }
    
    // Verify parent owns this teen
    const teen = await db.getUserById(teenId)
    if (!teen || teen.parent_id !== user.id) {
      return c.json({ error: 'Teen not found or access denied' }, 404)
    }
    
    // Get analytics data
    const stats = await db.getConversationStats(teenId, 30)
    const unreadAlerts = await db.getUnreadAlertCount(user.id)
    const recentConversations = await db.getConversationsByTeen(teenId)
    const recentAlerts = await db.getSafetyAlertsByParent(user.id)
    
    // Get today's usage
    const today = new Date().toISOString().split('T')[0]
    const todayUsage = await db.getDailyUsageStats(teenId, today)
    
    return c.json({
      teen: {
        id: teen.id,
        name: teen.name,
        email: teen.email
      },
      stats,
      todayUsage,
      unreadAlerts,
      recentConversations: recentConversations.results?.slice(0, 5) || [],
      recentAlerts: recentAlerts.results?.slice(0, 5) || []
    })
  } catch (error) {
    console.error('Analytics error:', error)
    return c.json({ error: 'Failed to load analytics' }, 500)
  }
})

app.get('/api/system/stats', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  try {
    const db = new DatabaseService(env.DB)
    const user = await db.validateSession(sessionId)
    
    if (!user || user.role !== 'parent') {
      return c.json({ error: 'Parent access required' }, 403)
    }
    
    const stats = await db.getSystemStats()
    return c.json(stats)
  } catch (error) {
    console.error('System stats error:', error)
    return c.json({ error: 'Failed to load system stats' }, 500)
  }
})

// Database initialization route (for setting up demo data)
app.post('/api/admin/init-demo', async (c) => {
  const { env } = c
  
  try {
    // Check if demo data already exists
    const existingUser = await env.DB.prepare(`
      SELECT id FROM users WHERE email = 'demo@teenai.com' LIMIT 1
    `).first()
    
    if (existingUser) {
      return c.json({ message: 'Demo data already exists' })
    }
    
    // Create demo parent
    const parentId = generateId()
    await env.DB.prepare(`
      INSERT INTO users (id, email, name, role)
      VALUES (?, ?, ?, ?)
    `).bind(parentId, 'demo@teenai.com', 'Demo Parent', 'parent').run()
    
    // Create demo teen
    const teenId = generateId()
    await env.DB.prepare(`
      INSERT INTO users (id, email, name, role, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(teenId, 'teen@teenai.com', 'Demo Teen', 'teen', parentId).run()
    
    // Create parental controls
    const controlsId = generateId()
    await env.DB.prepare(`
      INSERT INTO parental_controls (
        id, parent_id, teen_id, theological_perspective, content_filter_level,
        allowed_topics, blocked_keywords, safety_alerts_enabled, chat_review_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      controlsId, parentId, teenId, 'conservative-christian', 'strict',
      '["bible-study", "school-help", "life-advice", "science", "history"]',
      '["inappropriate", "violence", "drugs"]',
      true, true
    ).run()
    
    // Create demo custom GPT
    const gptId = generateId()
    await env.DB.prepare(`
      INSERT INTO custom_gpts (
        id, parent_id, name, description, system_prompt, 
        theological_values, educational_focus, personality_traits
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gptId, parentId, 'Demo Christian Tutor',
      'A wise Christian mentor for academic and spiritual guidance',
      'You are a Christian AI tutor designed to help teenagers grow in wisdom and knowledge. Approach every question through a biblical worldview, emphasizing God\'s love and truth.',
      '{"biblical_authority": "high", "moral_framework": "biblical"}',
      '["mathematics", "science", "biblical_studies"]',
      'encouraging,wise,patient,christ_centered'
    ).run()
    
    return c.json({ 
      success: true, 
      message: 'Demo data created successfully',
      credentials: {
        parent: 'demo@teenai.com',
        teen: 'teen@teenai.com'
      }
    })
  } catch (error) {
    console.error('Demo init error:', error)
    return c.json({ error: 'Failed to initialize demo data' }, 500)
  }
})

// Default route - Main application
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Teen AI Platform - Safe AI for Christian Families</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .gradient-bg {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .glass-card {
            backdrop-filter: blur(10px);
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
          }
        </style>
    </head>
    <body class="gradient-bg min-h-screen">
        <div id="app" class="min-h-screen flex items-center justify-center p-4">
            <!-- Loading state -->
            <div id="loading" class="text-center">
                <div class="animate-spin rounded-full h-32 w-32 border-b-2 border-white mx-auto mb-4"></div>
                <p class="text-white text-xl">Loading Teen AI Platform...</p>
            </div>
        </div>
        
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app