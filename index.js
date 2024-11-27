require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const { Deepgram } = require('@deepgram/sdk');
const twilio = require('twilio');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 3000;

// Initialisation de l'API OpenAI avec la version 4 du SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialisation de l'API Deepgram
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

  // Saluer l'appelant
  twiml.say('Bonjour, comment puis-je vous aider ?');

  // Démarrer l'enregistrement de l'audio
  twiml.record({
    action: '/twilio/recording',
    recordingStatusCallback: '/twilio/recording-status',
    maxLength: 60,
    transcribe: false,
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// Route pour gérer l'enregistrement audio et le transcrire avec Deepgram puis WebSocket OpenAI
app.post('/twilio/recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl + '.mp3';

  try {
    // Transcrire l'enregistrement audio avec Deepgram
    const transcriptionResponse = await deepgram.transcription.preRecorded(
      { url: recordingUrl },
      { punctuate: true, language: 'fr' }
    );

    const transcription = transcriptionResponse.results.channels[0].alternatives[0].transcript;

    console.log('Transcription reçue de Deepgram :', transcription);

    // Créer une connexion WebSocket vers l'API Realtime d'OpenAI
    const ws = new WebSocket('wss://api.openai.com/v1/realtime', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      }
    });

    ws.on('open', () => {
      console.log('WebSocket connecté à OpenAI');

      // Envoyer la transcription reçue de Deepgram au WebSocket pour traitement
      const event = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: transcription
        }
      };

      ws.send(JSON.stringify(event));
    });

    ws.on('message', (data) => {
      const response = JSON.parse(data);
      if (response.item && response.item.type === 'output_text') {
        const generatedText = response.item.content;

        console.log('Texte généré par OpenAI :', generatedText);

        // Utiliser Twilio pour jouer la réponse à l'appelant
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say(generatedText);

        res.type('text/xml');
        res.send(twiml.toString());
      }
    });

    ws.on('error', (error) => {
      console.error('Erreur de connexion WebSocket :', error);
      res.status(500).send('Erreur lors de la connexion au WebSocket');
    });

    ws.on('close', () => {
      console.log('Connexion WebSocket fermée');
    });
  } catch (error) {
    console.error('Erreur lors de la transcription ou de la génération de la réponse :', error);
    res.status(500).send('Erreur lors de la transcription ou de la génération de la réponse');
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
