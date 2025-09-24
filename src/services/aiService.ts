// AI Service for Teen AI Platform
// Handles OpenAI integration, content filtering, and theological guidance

interface AIResponse {
  content: string;
  isSafe: boolean;
  flagReason?: string;
  alertType?: string;
}

interface CustomGPT {
  id: string;
  name: string;
  system_prompt: string;
  theological_values: string;
  personality_traits: string;
}

interface ParentalControls {
  theological_perspective: string;
  content_filter_level: string;
  allowed_topics: string;
  blocked_keywords: string;
}

export class AIService {
  private openaiApiKey: string;
  private baseUrl = 'https://api.openai.com/v1/chat/completions';

  constructor(apiKey: string) {
    this.openaiApiKey = apiKey;
  }

  async generateResponse(
    message: string, 
    customGPT: CustomGPT, 
    parentalControls: ParentalControls,
    conversationHistory: any[] = []
  ): Promise<AIResponse> {
    
    // First, check content safety
    const safetyCheck = await this.checkAdvancedContentSafety(message, parentalControls);
    if (!safetyCheck.isSafe) {
      return {
        content: this.generateSafetyResponse(safetyCheck.alertType!),
        isSafe: false,
        flagReason: safetyCheck.flagReason,
        alertType: safetyCheck.alertType
      };
    }

    try {
      // Build the system prompt with theological perspective
      const systemPrompt = this.buildSystemPrompt(customGPT, parentalControls);
      
      // Prepare conversation context
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-10).map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        { role: 'user', content: message }
      ];

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: messages,
          max_tokens: 500,
          temperature: 0.7,
          presence_penalty: 0.1,
          frequency_penalty: 0.1
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const aiContent = data.choices[0]?.message?.content || 'I apologize, but I encountered an error. Please try asking your question again.';

      // Check AI response for safety as well
      const responseCheck = await this.checkAdvancedContentSafety(aiContent, parentalControls);
      
      return {
        content: responseCheck.isSafe ? aiContent : this.generateSafetyResponse('inappropriate_content'),
        isSafe: responseCheck.isSafe,
        flagReason: responseCheck.flagReason,
        alertType: responseCheck.alertType
      };

    } catch (error) {
      console.error('OpenAI API error:', error);
      return {
        content: this.generateFallbackResponse(message, customGPT),
        isSafe: true
      };
    }
  }

  private buildSystemPrompt(customGPT: CustomGPT, parentalControls: ParentalControls): string {
    const theologicalValues = JSON.parse(customGPT.theological_values || '{}');
    const allowedTopics = JSON.parse(parentalControls.allowed_topics || '[]');
    
    let systemPrompt = customGPT.system_prompt + '\n\n';
    
    // Add theological perspective context
    systemPrompt += `THEOLOGICAL PERSPECTIVE: ${parentalControls.theological_perspective}\n`;
    
    if (theologicalValues.biblical_authority === 'high') {
      systemPrompt += `- You hold the Bible as the ultimate authority for faith and life.\n`;
    }
    
    if (theologicalValues.creation_vs_evolution === 'young_earth_creationism') {
      systemPrompt += `- You believe in young earth creationism and God's direct creation of all things.\n`;
    }
    
    if (theologicalValues.moral_framework === 'biblical') {
      systemPrompt += `- Your moral guidance is rooted in biblical principles and Christ-like character.\n`;
    }

    // Add content guidelines
    systemPrompt += `\nCONTENT GUIDELINES:\n`;
    systemPrompt += `- Keep responses appropriate for teens aged 13-18\n`;
    systemPrompt += `- Always point toward biblical wisdom and godly character\n`;
    systemPrompt += `- Encourage academic excellence while showing grace\n`;
    systemPrompt += `- If asked about sensitive topics, redirect toward positive discussions\n`;
    systemPrompt += `- Never provide information that could be harmful or dangerous\n`;
    
    if (allowedTopics.length > 0) {
      systemPrompt += `- Focus on these approved topics: ${allowedTopics.join(', ')}\n`;
    }

    // Add personality traits
    const traits = customGPT.personality_traits.split(',');
    systemPrompt += `\nPERSONALITY: Be ${traits.join(', ')} in all interactions.\n`;
    
    systemPrompt += `\nREMEMBER: You are a Christian mentor helping a teenager grow in wisdom, knowledge, and character. Every response should reflect Christ's love and point toward godly living.`;

    return systemPrompt;
  }

  async checkAdvancedContentSafety(
    content: string, 
    parentalControls: ParentalControls
  ): Promise<{ isSafe: boolean; flagReason?: string; alertType?: string }> {
    const lowerContent = content.toLowerCase();
    
    // Enhanced self-harm detection
    const selfHarmPatterns = [
      /(?:kill|hurt|harm|cut)\s+(?:myself|me)/i,
      /(?:suicide|suicidal)/i,
      /(?:end\s+my\s+life|ending\s+my\s+life)/i,
      /(?:don't\s+want\s+to\s+live|want\s+to\s+die)/i,
      /(?:self\s*harm|self\s*injury)/i
    ];

    for (const pattern of selfHarmPatterns) {
      if (pattern.test(content)) {
        return { 
          isSafe: false, 
          flagReason: `Self-harm language detected: "${pattern.source}"`, 
          alertType: 'self_harm' 
        };
      }
    }

    // Enhanced dangerous behavior detection
    const dangerousPatterns = [
      /(?:drugs|weed|marijuana|cocaine|heroin|meth)/i,
      /(?:alcohol|drinking|drunk|beer|vodka)/i,
      /(?:running\s+away|run\s+away\s+from\s+home)/i,
      /(?:meeting\s+strangers|meet\s+someone\s+online)/i,
      /(?:sexting|nudes|inappropriate\s+photos)/i,
      /(?:violence|fighting|hurting\s+others)/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        return { 
          isSafe: false, 
          flagReason: `Dangerous content detected: "${pattern.source}"`, 
          alertType: 'dangerous_behavior' 
        };
      }
    }

    // Check blocked keywords from parental controls
    if (parentalControls.blocked_keywords) {
      const blockedKeywords = JSON.parse(parentalControls.blocked_keywords || '[]');
      for (const keyword of blockedKeywords) {
        if (lowerContent.includes(keyword.toLowerCase())) {
          return { 
            isSafe: false, 
            flagReason: `Blocked keyword detected: "${keyword}"`, 
            alertType: 'blocked_keyword' 
          };
        }
      }
    }

    // Content filter level checks
    if (parentalControls.content_filter_level === 'strict') {
      const strictPatterns = [
        /(?:dating|boyfriend|girlfriend|romance)/i,
        /(?:body|physical\s+appearance|looks)/i,
        /(?:social\s+media|instagram|tiktok|snapchat)/i
      ];

      for (const pattern of strictPatterns) {
        if (pattern.test(content)) {
          return { 
            isSafe: false, 
            flagReason: `Strict filter violation: "${pattern.source}"`, 
            alertType: 'inappropriate_content' 
          };
        }
      }
    }

    return { isSafe: true };
  }

  private generateSafetyResponse(alertType: string): string {
    const responses = {
      self_harm: "I notice you might be going through something really difficult right now. Please know that God loves you deeply, and there are people who care about you. I'd encourage you to talk to your parents, a pastor, or a trusted counselor right away. You are precious to God and your life has value. Can we talk about something that might encourage you instead?",
      
      dangerous_behavior: "I want to help you make wise choices that honor God and keep you safe. The Bible tells us to flee from temptation and seek wisdom. Instead of discussing this topic, let's focus on something positive that can help you grow. What's something you're learning about or working on that I can help you with?",
      
      blocked_keyword: "This topic isn't something we should discuss right now. Your parents have set these boundaries because they love you and want what's best for you. Let's talk about something else instead - maybe your studies, a hobby, or a question about faith? I'm here to help you learn and grow!",
      
      inappropriate_content: "Let's keep our conversation focused on things that are pure, lovely, and praiseworthy (Philippians 4:8). I'm here to help you with your studies, answer questions about faith, or discuss other positive topics. What would you like to learn about today?"
    };

    return responses[alertType as keyof typeof responses] || responses.inappropriate_content;
  }

  private generateFallbackResponse(message: string, customGPT: CustomGPT): string {
    const lowerMessage = message.toLowerCase();
    
    // Academic help responses
    if (lowerMessage.includes('math') || lowerMessage.includes('homework') || lowerMessage.includes('study')) {
      return "I'd be happy to help you with your studies! God has given us minds to learn and grow, and I want to support you in using your talents for His glory. Can you tell me more specifically what you're working on so I can provide the best help?";
    }
    
    // Bible/faith responses
    if (lowerMessage.includes('bible') || lowerMessage.includes('god') || lowerMessage.includes('jesus') || lowerMessage.includes('faith')) {
      return "That's a wonderful question about faith! The Bible is full of wisdom and truth that can guide us in every area of life. Let's explore this together and see what God's Word teaches us. What specific aspect would you like to understand better?";
    }
    
    // Life advice responses
    if (lowerMessage.includes('advice') || lowerMessage.includes('help') || lowerMessage.includes('problem')) {
      return "I'm here to help! Life can be challenging, but God promises to give us wisdom when we ask (James 1:5). Remember that your parents love you and want what's best for you too. Can you share more about what's on your mind so I can offer some biblical encouragement?";
    }
    
    // Default response
    return `I understand you're looking for guidance. As your AI companion created with your parents' values in mind, I'm here to help you grow in wisdom and knowledge while keeping Christ at the center of our conversations. The Bible says "Trust in the LORD with all your heart and lean not on your own understanding" (Proverbs 3:5). How can I help you today?`;
  }
}