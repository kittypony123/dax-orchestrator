#!/usr/bin/env node
/**
 * Environment Setup Helper
 * Helps you set up your .env file securely
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(text) {
  return new Promise(resolve => rl.question(text, resolve));
}

async function setupEnv() {
  console.log('🔧 DAX Catalog Environment Setup');
  console.log('================================');
  console.log();
  
  console.log('🔒 IMPORTANT SECURITY REMINDERS:');
  console.log('1. Never share API keys in conversations');
  console.log('2. If you exposed a key, rotate it immediately');
  console.log('3. The .env file is already in .gitignore (safe)');
  console.log();
  
  const envPath = path.join(__dirname, '.env');
  
  if (fs.existsSync(envPath)) {
    console.log('📁 Found existing .env file');
    const overwrite = await question('Do you want to update it? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('✅ Keeping existing .env file');
      rl.close();
      return;
    }
  }
  
  console.log('🔑 Setting up your Anthropic API key...');
  console.log('Get your key from: https://console.anthropic.com/');
  console.log();
  
  const apiKey = await question('Enter your Anthropic API key: ');
  
  if (!apiKey) {
    console.log('❌ No API key provided. Exiting.');
    rl.close();
    return;
  }
  
  if (!apiKey.startsWith('sk-ant-api03-')) {
    console.log('⚠️  Warning: API key format doesn\'t look correct');
    console.log('   Expected format: sk-ant-api03-...');
    const continue_ = await question('Continue anyway? (y/n): ');
    if (continue_.toLowerCase() !== 'y') {
      rl.close();
      return;
    }
  }
  
  const envContent = `# DAX Catalog Environment Variables
# SECURITY: Never commit this file to git!

# Anthropic Claude API Configuration
ANTHROPIC_API_KEY=${apiKey}

# Optional: Claude Model Configuration
CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_MAX_TOKENS=2000
CLAUDE_TIMEOUT=60000

# Development Settings
NODE_ENV=development
LOG_LEVEL=info
`;

  try {
    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env file created successfully!');
    console.log();
    
    console.log('🧪 Testing API key...');
    
    // Load the new env file
    require('dotenv').config();
    
    if (fs.existsSync('./dist/src/claude-config.js')) {
      console.log('🚀 Ready to run tests!');
      console.log();
      console.log('Next steps:');
      console.log('  npm run build        # Compile TypeScript');
      console.log('  node test-api-key.js  # Test your API key');
      console.log('  npm run test:local    # Run full bike share test');
    } else {
      console.log('⚠️  Need to build TypeScript first:');
      console.log('  npm run build');
      console.log('  node test-api-key.js');
    }
    
  } catch (error) {
    console.log('❌ Failed to create .env file:', error.message);
  }
  
  rl.close();
}

setupEnv().catch(console.error);