#!/bin/bash

# Teen AI Platform - OpenAI Setup Script
echo "🚀 Teen AI Platform - OpenAI Setup"
echo "=================================="
echo ""

echo "📋 Step 1: Get your OpenAI API Key"
echo "   Visit: https://platform.openai.com/api-keys"
echo "   Create a new secret key and copy it"
echo ""

echo "🔐 Step 2: Add key to Cloudflare Pages"
echo "   Run this command and paste your key when prompted:"
echo "   npx wrangler pages secret put OPENAI_API_KEY --project-name teen-ai-platform"
echo ""

echo "✅ Step 3: Verify the key was added"
echo "   npx wrangler pages secret list --project-name teen-ai-platform"
echo ""

echo "🧪 Step 4: Test the integration"
echo "   Visit: https://e0ffa1a2.teen-ai-platform.pages.dev"
echo "   Login with: demo@teenai.com"
echo "   Start a conversation and ask: 'Can you help me with math homework?'"
echo ""

echo "💡 Expected Result:"
echo "   Before: Simple fallback responses"
echo "   After:  Rich, contextual AI responses with biblical wisdom"
echo ""

read -p "Press Enter when you're ready to proceed with the setup..."

echo "🔐 Adding OpenAI API key to production..."
npx wrangler pages secret put OPENAI_API_KEY --project-name teen-ai-platform

echo ""
echo "✅ Verifying the key was added..."
npx wrangler pages secret list --project-name teen-ai-platform

echo ""
echo "🎉 Setup complete! Your Teen AI Platform now has full AI capabilities."
echo "   Production URL: https://e0ffa1a2.teen-ai-platform.pages.dev"
echo "   Demo Login: demo@teenai.com"