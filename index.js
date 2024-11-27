require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const { Deepgram } = require('@deepgram/sdk');
const WebSocket = require('ws');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 3000;

// Initialisation de l'API OpenAI avec la version 4 du SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialisation de l'API Deepgram avec la version 3
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

// Configuration de l'API Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(express.json());

// Route de base pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
  res.send('Backend for JAPL 1.0 Voice Assistant is running.');
});

// Route pour gérer les appels Twilio
app.post('/twilio/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Accueil du client avec un message vocal
  twiml.say('Bonjour, comment puis-je vous aider?');
  twiml.record({
    action: '/twilio/recording',
    recordingStatusCallback: '/twilio/recording-status',
    maxLength: 60,
    transcribe: false,
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// Route pour gérer l'enregistrement audio et le transcrire avec Deepgram
app.post('/twilio/recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl + '.mp3';

  try {
    // Transcrire l'enregistrement audio avec Deepgram
    const response = await deepgram.transcription.preRecorded(
      { url: recordingUrl },
      { punctuate: true }
    );

    const transcription = response.results.channels[0].alternatives[0].transcript;

    // Générer une réponse avec GPT-4 en utilisant le SDK OpenAI
    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: transcription }],
    });

    const generatedText = gptResponse.choices[0].message.content.trim();

    // Utiliser la synthèse vocale en temps réel d'OpenAI via WebSocket pour la réponse
    const ws = new WebSocket('wss://api.openai.com/v1/audio/synthesize', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    ws.on('open', () => {
      const event = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'input_text',
              text: generatedText,
            },
          ],
        },
      };

      ws.send(JSON.stringify(event));
      ws.send(JSON.stringify({ type: 'response.create' }));
    });

    ws.on('message', (data) => {
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.play({ loop: 1 }, `data:audio/mpeg;base64,${Buffer.from(data).toString('base64')}`);
      
      res.type('text/xml');
      res.send(twiml.toString());
    });

    ws.on('error', (error) => {
      console.error('Erreur lors de la génération de la réponse audio :', error);
      res.status(500).send('Erreur lors de la génération de la réponse audio');
    });

  } catch (error) {
    console.error('Erreur lors de la génération de la réponse :', error);
    res.status(500).send('Erreur lors de la génération de la réponse');
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
