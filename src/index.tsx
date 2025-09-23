import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

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

async function createSession(db: D1Database, userId: string): Promise<string> {
  const sessionId = generateId()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30) // 30 days
  
  await db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(sessionId, userId, expiresAt.toISOString()).run()
  
  return sessionId
}

async function validateSession(db: D1Database, sessionId: string): Promise<any> {
  const result = await db.prepare(`
    SELECT u.*, s.id as session_id
    FROM users u
    JOIN sessions s ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).bind(sessionId).first()
  
  return result
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
    const userId = generateId()
    let parentId = null
    
    if (role === 'teen') {
      if (!parentEmail) {
        return c.json({ error: 'Parent email required for teen accounts' }, 400)
      }
      
      const parent = await env.DB.prepare(`
        SELECT id FROM users WHERE email = ? AND role = 'parent'
      `).bind(parentEmail).first()
      
      if (!parent) {
        return c.json({ error: 'Parent account not found' }, 404)
      }
      
      parentId = parent.id
    }
    
    await env.DB.prepare(`
      INSERT INTO users (id, email, name, role, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, email, name, role, parentId).run()
    
    const sessionId = await createSession(env.DB, userId)
    
    return c.json({ 
      success: true, 
      user: { id: userId, email, name, role, parentId },
      sessionId 
    })
  } catch (error: any) {
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
  
  const user = await env.DB.prepare(`
    SELECT * FROM users WHERE email = ? AND is_active = TRUE
  `).bind(email).first()
  
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  
  const sessionId = await createSession(env.DB, user.id as string)
  
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
  
  const user = await validateSession(env.DB, sessionId)
  if (!user) {
    return c.json({ error: 'Invalid session' }, 401)
  }
  
  let parentId = user.id
  if (user.role === 'teen') {
    parentId = user.parent_id
  }
  
  const gpts = await env.DB.prepare(`
    SELECT * FROM custom_gpts WHERE parent_id = ? AND is_active = TRUE
    ORDER BY created_at DESC
  `).bind(parentId).all()
  
  return c.json(gpts.results)
})

app.post('/api/custom-gpts', async (c) => {
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
  
  try {
    await env.DB.prepare(`
      INSERT INTO custom_gpts (
        id, parent_id, name, description, system_prompt,
        theological_values, educational_focus, personality_traits
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gptId, user.id, name, description, systemPrompt,
      JSON.stringify(theologicalValues), JSON.stringify(educationalFocus), personalityTraits
    ).run()
    
    return c.json({ success: true, id: gptId })
  } catch (error) {
    return c.json({ error: 'Failed to create custom GPT' }, 500)
  }
})

// Chat routes
app.get('/api/conversations', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user) {
    return c.json({ error: 'Invalid session' }, 401)
  }
  
  let query = ''
  let userId = user.id
  
  if (user.role === 'parent') {
    // Parents can see all conversations of their teens
    query = `
      SELECT c.*, u.name as teen_name, cg.name as gpt_name
      FROM conversations c
      JOIN users u ON c.teen_id = u.id
      JOIN custom_gpts cg ON c.custom_gpt_id = cg.id
      WHERE u.parent_id = ?
      ORDER BY c.updated_at DESC
    `
  } else {
    // Teens can only see their own conversations
    query = `
      SELECT c.*, cg.name as gpt_name
      FROM conversations c
      JOIN custom_gpts cg ON c.custom_gpt_id = cg.id
      WHERE c.teen_id = ?
      ORDER BY c.updated_at DESC
    `
  }
  
  const conversations = await env.DB.prepare(query).bind(userId).all()
  return c.json(conversations.results)
})

app.post('/api/conversations', async (c) => {
  const { env } = c
  const sessionId = c.req.header('Authorization')?.replace('Bearer ', '')
  
  if (!sessionId) {
    return c.json({ error: 'Authentication required' }, 401)
  }
  
  const user = await validateSession(env.DB, sessionId)
  if (!user || user.role !== 'teen') {
    return c.json({ error: 'Teen access required' }, 403)
  }
  
  const { customGptId, title } = await c.req.json()
  
  if (!customGptId || !title) {
    return c.json({ error: 'Custom GPT ID and title required' }, 400)
  }
  
  const conversationId = generateId()
  
  try {
    await env.DB.prepare(`
      INSERT INTO conversations (id, teen_id, custom_gpt_id, title)
      VALUES (?, ?, ?, ?)
    `).bind(conversationId, user.id, customGptId, title).run()
    
    return c.json({ success: true, id: conversationId })
  } catch (error) {
    return c.json({ error: 'Failed to create conversation' }, 500)
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
  
  const user = await validateSession(env.DB, sessionId)
  if (!user || user.role !== 'teen') {
    return c.json({ error: 'Teen access required' }, 403)
  }
  
  const { content } = await c.req.json()
  
  if (!content) {
    return c.json({ error: 'Message content required' }, 400)
  }
  
  // Verify teen owns this conversation
  const conversation = await env.DB.prepare(`
    SELECT * FROM conversations WHERE id = ? AND teen_id = ?
  `).bind(conversationId, user.id).first()
  
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404)
  }
  
  // Get parental controls
  const parentalControls = await env.DB.prepare(`
    SELECT * FROM parental_controls WHERE teen_id = ?
  `).bind(user.id).first()
  
  if (!parentalControls) {
    return c.json({ error: 'Parental controls not configured' }, 400)
  }
  
  // Check content safety
  const safetyCheck = await checkContentSafety(content, parentalControls)
  
  const messageId = generateId()
  let isFlagged = false
  let flagReason = null
  
  if (!safetyCheck.isSafe) {
    isFlagged = true
    flagReason = safetyCheck.reason
    
    // Send safety alert to parent if enabled
    if (parentalControls.safety_alerts_enabled && user.parent_id) {
      await sendSafetyAlert(
        env.DB, user.parent_id, user.id, conversationId, 
        messageId, safetyCheck.alertType!, safetyCheck.reason!
      )
    }
  }
  
  // Save user message
  await env.DB.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, is_flagged, flag_reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(messageId, conversationId, 'user', content, isFlagged, flagReason).run()
  
  // Generate AI response (simplified for now)
  const customGpt = await env.DB.prepare(`
    SELECT cg.* FROM custom_gpts cg
    JOIN conversations c ON c.custom_gpt_id = cg.id
    WHERE c.id = ?
  `).bind(conversationId).first()
  
  let aiResponse = "I understand you're looking for guidance. As your AI companion, I'm here to help you grow in wisdom and knowledge while keeping Christ at the center of our conversations."
  
  if (!isFlagged && customGpt) {
    // Here you would integrate with OpenAI API using the custom GPT system prompt
    // For now, using a simple response based on the theological perspective
    if (content.toLowerCase().includes('math') || content.toLowerCase().includes('homework')) {
      aiResponse = "I'd be happy to help with your studies! Remember that God has given us minds to learn and grow. Let's work through this together step by step. What specific part would you like help with?"
    } else if (content.toLowerCase().includes('bible') || content.toLowerCase().includes('god')) {
      aiResponse = "That's a wonderful question about faith! The Bible tells us to 'seek and you will find' (Matthew 7:7). Let's explore this together and see what God's Word teaches us about this topic."
    }
  } else if (isFlagged) {
    aiResponse = "I notice you might be going through something difficult. Remember that God loves you deeply, and there are people who care about you. If you're struggling, please talk to a trusted adult like your parents, a teacher, or a counselor. Is there something positive I can help you with instead?"
  }
  
  // Save AI response
  const aiMessageId = generateId()
  await env.DB.prepare(`
    INSERT INTO messages (id, conversation_id, role, content)
    VALUES (?, ?, ?, ?)
  `).bind(aiMessageId, conversationId, 'assistant', aiResponse).run()
  
  // Update conversation timestamp
  await env.DB.prepare(`
    UPDATE conversations SET updated_at = datetime('now') WHERE id = ?
  `).bind(conversationId).run()
  
  return c.json({ 
    success: true, 
    userMessage: { id: messageId, content, isFlagged },
    aiMessage: { id: aiMessageId, content: aiResponse }
  })
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