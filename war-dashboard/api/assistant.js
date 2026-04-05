'use strict';

const https = require('https');

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
              }

                if (req.method !== 'POST') {
                    return res.status(405).json({ error: 'Method not allowed' });
                      }

                        try {

                            const apiKey = process.env.ANTHROPIC_API_KEY;

                                if (!apiKey) {
                                      return res.status(500).json({ error: 'ANTHROPIC_API_KEY missing' });
                                          }

                                              const body = req.body || {};

                                                  const message = (body.message || '').toString().trim();
                                                      const context = (body.context || '').toString().trim();

                                                          if (!message) {
                                                                return res.status(400).json({ error: 'message required' });
                                                                    }

                                                                        const prompt = context
                                                                              ? `السياق:\n${context}\n\nالسؤال:\n${message}`
                                                                                    : message;

                                                                                        const payload = JSON.stringify({
                                                                                              model: "claude-3-haiku-20240307",
                                                                                                    max_tokens: 600,
                                                                                                          messages: [
                                                                                                                  {
                                                                                                                            role: "user",
                                                                                                                                      content: prompt
                                                                                                                                              }
                                                                                                                                                    ]
                                                                                                                                                        });

                                                                                                                                                            const options = {
                                                                                                                                                                  hostname: 'api.anthropic.com',
                                                                                                                                                                        path: '/v1/messages',
                                                                                                                                                                              method: 'POST',
                                                                                                                                                                                    headers: {
                                                                                                                                                                                            'Content-Type': 'application/json',
                                                                                                                                                                                                    'x-api-key': apiKey,
                                                                                                                                                                                                            'anthropic-version': '2023-06-01',
                                                                                                                                                                                                                    'Content-Length': Buffer.byteLength(payload)
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                              };

                                                                                                                                                                                                                                  const request = https.request(options, (response) => {

                                                                                                                                                                                                                                        let data = '';

                                                                                                                                                                                                                                              response.on('data', chunk => {
                                                                                                                                                                                                                                                      data += chunk;
                                                                                                                                                                                                                                                            });

                                                                                                                                                                                                                                                                  response.on('end', () => {

                                                                                                                                                                                                                                                                          try {

                                                                                                                                                                                                                                                                                    const json = JSON.parse(data);

                                                                                                                                                                                                                                                                                              if (!response.statusCode || response.statusCode >= 400) {
                                                                                                                                                                                                                                                                                                          return res.status(500).json({
                                                                                                                                                                                                                                                                                                                        error: json?.error?.message || 'Claude API error'
                                                                                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                                                                                              }

                                                                                                                                                                                                                                                                                                                                                        const text =
                                                                                                                                                                                                                                                                                                                                                                    json?.content?.map(x => x.text).join("\n") || '';

                                                                                                                                                                                                                                                                                                                                                                              return res.status(200).json({
                                                                                                                                                                                                                                                                                                                                                                                          response: text
                                                                                                                                                                                                                                                                                                                                                                                                    });

                                                                                                                                                                                                                                                                                                                                                                                                            } catch (e) {
                                                                                                                                                                                                                                                                                                                                                                                                                      return res.status(500).json({
                                                                                                                                                                                                                                                                                                                                                                                                                                  error: 'Failed parsing Claude response',
                                                                                                                                                                                                                                                                                                                                                                                                                                              raw: data
                                                                                                                                                                                                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                                                                                                                                                                                                                }

                                                                                                                                                                                                                                                                                                                                                                                                                                                                      });

                                                                                                                                                                                                                                                                                                                                                                                                                                                                          });

                                                                                                                                                                                                                                                                                                                                                                                                                                                                              request.on('error', err => {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    console.error(err);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          return res.status(500).json({
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  error: err.message
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        });
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            });

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                request.write(payload);
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    request.end();

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      } catch (err) {

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          console.error(err);

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              return res.status(500).json({
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    error: err.message
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        });

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          }

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          };