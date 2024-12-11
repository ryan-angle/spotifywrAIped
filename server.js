import express from 'express';
import axios from 'axios';
import * as querystring from 'querystring';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7768;

// Spotify App Credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = 'https://spotifywraipped.onrender.com/callback';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // For parsing JSON in request body
app.use(
  session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);

// Initialize OpenAI API
const openaiApiHeaders = {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
};

// Root Route: Serve the landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Step 1: Login Route
app.get('/login', (req, res) => {
  const scope = 'user-top-read';
  const spotifyAuthURL =
    'https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scope,
      redirect_uri: REDIRECT_URI,
    });
  res.redirect(spotifyAuthURL);
});

// Step 2: Callback Route
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
  
    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        querystring.stringify({
          code: code,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
          },
        }
      );
  
      const { access_token, refresh_token } = tokenResponse.data;
  
      // Fetch user's top artists
      const userTopArtistsResponse = await axios.get(
        'https://api.spotify.com/v1/me/top/artists',
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
          params: {
            time_range: 'medium_term', // This ensures artists are from the past 4 weeks
            limit: 20, // Fetch top 10 artists
          },
        }
      );
  
      // Extract top artists
      const topArtists = userTopArtistsResponse.data.items.map(
        (artist) => artist.name
      );
  
      // Store tokens and artists in session
      req.session.accessToken = access_token;
      req.session.refreshToken = refresh_token;
      req.session.topArtists = topArtists;
  
      console.log('Session after callback:', req.session);
  
      // Redirect to game page
      res.redirect('/game');
    } catch (error) {
      console.error(
        'Error during authentication or fetching user data:',
        error.response?.data || error.message
      );
      res.send('Error during authentication');
    }
});

app.get('/game', (req, res) => {
  if (!req.session.topArtists) {
    return res.redirect('/'); // Redirect to login if no data
  }
  res.sendFile(path.join(__dirname, 'public/game.html'));
});

// API to Start Game
app.get('/start-game', async (req, res) => {
    if (!req.session.topArtists || req.session.topArtists.length < 2) {
        return res.status(400).json({ error: 'Not enough top artists to play the game.' });
    }

    try {
        const artistPoolSize = Math.min(req.session.topArtists.length, 10);
        const shuffledArtists = [...req.session.topArtists].sort(() => 0.5 - Math.random());
        const options = shuffledArtists.slice(0, artistPoolSize);

        console.log('Artist Pool for Game:', options);

        // Pick one artist as the correct answer
        const correctArtist = options[Math.floor(Math.random() * options.length)];

        const openAIResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a lyric generator in the style of famous artists.' },
                    { role: 'user', content: `Write a short lyric in the style of ${correctArtist}.` }
                ],
                max_tokens: 50,
                temperature: 0.7
            },
            { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
        );

        const lyric = openAIResponse.data.choices[0].message.content.trim();

        // Return the lyric and options to the client
        res.json({ lyric, options, correctArtist });
    } catch (error) {
        console.error('Error starting game:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to start game.' });
    }
});

// API to fetch top artists
app.get('/api/top-artists', async (req, res) => {
    const accessToken = req.session.accessToken;

    if (!accessToken) {
        return res.status(403).json({ error: 'No access token. Please log in again.' });
    }

    try {
        // Use the Spotify API to fetch top artists for the medium term
        const response = await axios.get('https://api.spotify.com/v1/me/top/artists', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            params: {
                time_range: 'medium_term', // Fetch top artists from the last 6 months
                limit: 20,                // Limit the number of artists returned
            },
        });

        const topArtists = response.data.items.map((artist) => artist.name);
        req.session.topArtists = topArtists;

        res.json({ topArtists });
    } catch (error) {
        console.error('Error fetching top artists:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch top artists.' });
    }
});


app.post('/api/generate-lyric', async (req, res) => {
    const { artist } = req.body;

    try {
        console.log(`Generating lyric for artist: ${artist}`);

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a lyric generator in the style of famous artists.' },
                    { role: 'user', content: `Write exactly 2 lines of lyrics in the style of ${artist}.` }
                ],
                max_tokens: 50,
                temperature: 0.7,
            },
            { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
        );

        // Extract the generated lyric from the response
        const lyric = response.data.choices[0]?.message?.content.trim();

        if (!lyric) {
            throw new Error('Lyric generation failed: No content in response.');
        }

        console.log('Generated Lyric:', lyric);
        res.json({ lyric });
    } catch (error) {
        console.error('Error generating lyric:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to generate lyric.' });
    }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
