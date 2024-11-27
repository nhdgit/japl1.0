require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');
const { createClient } = require('@deepgram/sdk');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 3000;

// Initialisation de l'API OpenAI avec la version 4 du SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialisation de l'API Deepgram version 3
const deepgram = createClient({
  apiKey: process.env.DEEPGRAM_API_KEY,
});

// Configuration de l'API Twilio
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(express.json());

// Route de base pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
  res.send('Backend for JAPL 1.0 Voice Assistant is running.');
});

// Route pour gérer les appels Twilio
app.post('/twilio/voice', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Utiliser OpenAI pour générer l'audio du message de bienvenue
  const initialText = 'Bonjour, comment puis-je vous aider ?';
  try {
    // Utiliser la synthèse vocale avec l'API TTS d'OpenAI
    const ttsResponse = await axios.post(
      'https://api.openai.com/v1/audio/synthesize',
      {
        input: initialText,
        voice: 'fr-realistic', // Choisir une voix française naturelle d'OpenAI
        model: 'tts-1-hd', // Modèle optimisé pour la qualité
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer', // Pour recevoir les données audio
      }
    );

    // Jouer l'audio généré au client avec Twilio
    twiml.play({ loop: 1 }, `data:audio/mpeg;base64,${Buffer.from(ttsResponse.data).toString('base64')}`);

    // Enregistrer l'audio de la réponse du client
    twiml.record({
      action: '/twilio/recording',
      recordingStatusCallback: '/twilio/recording-status',
      maxLength: 60,
      transcribe: false,
    });

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error("Erreur lors de la génération de l'audio initial :", error);
    res.status(500).send('Erreur lors de la génération de l'audio initial');
  }
});

// Route pour gérer l'enregistrement audio et le transcrire avec Deepgram
app.post('/twilio/recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl + '.mp3';

  try {
    // Transcrire l'enregistrement audio avec Deepgram
    const response = await deepgram.transcription.prerecorded({
      url: recordingUrl,
      options: { punctuate: true }
    });

    const transcription = response.results.channels[0].alternatives[0].transcript;

    // Générer une réponse avec GPT-4 en utilisant le nouveau SDK OpenAI
    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: transcription }],
    });

    const generatedText = gptResponse.choices[0].message.content.trim();

    // Utiliser la synthèse vocale avec l'API TTS d'OpenAI pour la réponse
    const ttsResponse = await axios.post(
      'https://api.openai.com/v1/audio/synthesize',
      {
        input: generatedText,
        voice: 'fr-realistic', // Choisir une voix française naturelle d'OpenAI
        model: 'tts-1-hd', // Modèle optimisé pour la qualité
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer', // Pour recevoir les données audio
      }
    );

    // Envoyer l'audio généré à Twilio pour le jouer au client
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.play({ loop: 1 }, `data:audio/mpeg;base64,${Buffer.from(ttsResponse.data).toString('base64')}`);
    
    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error('Erreur lors de la génération de la réponse :', error);
    res.status(500).send('Erreur lors de la génération de la réponse');
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});