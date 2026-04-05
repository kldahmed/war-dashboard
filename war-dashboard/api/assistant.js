'use strict';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (req.method === 'OPTIONS') {
              return res.status(200).end();
                }

                  if (req.method !== 'POST') {
                      return res.status(405).json({ error: 'Method not allowed' });
                        }

                          try {
                              const apiKey = process.env.ANTHROPIC_API_KEY;
                                  if (!apiKey) {
                                        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
                                            }

                                                const body = req.body || {};
                                                    const message = String(body.message || '').trim();
                                                        const context = String(body.context || '').trim();

                                                            if (!message) {
                                                                  return res.status(400).json({ error: 'message is required' });
                                                                      }

                                                                          const prompt = context
                                                                                ? `السياق:\n${context}\n\nالسؤال:\n${message}`
                                                                                      : message;

                                                                                          const response = await fetch('https://api.anthropic.com/v1/messages', {
                                                                                                method: 'POST',
                                                                                                      headers: {
                                                                                                              'content-type': 'application/json',
                                                                                                                      'x-api-key': apiKey,
                                                                                                                              'anthropic-version': '2023-06-01'
                                                                                                                                    },
                                                                                                                                          body: JSON.stringify({
                                                                                                                                                  model: 'claude-3-5-sonnet-20241022',
                                                                                                                                                          max_tokens: 900,
                                                                                                                                                                  temperature: 0.4,
                                                                                                                                                                          messages: [
                                                                                                                                                                                    {
                                                                                                                                                                                                role: 'user',
                                                                                                                                                                                                            content: prompt
                                                                                                                                                                                                                      }
                                                                                                                                                                                                                              ]
                                                                                                                                                                                                                                    })
                                                                                                                                                                                                                                        });

                                                                                                                                                                                                                                            const data = await response.json();

                                                                                                                                                                                                                                                if (!response.ok) {
                                                                                                                                                                                                                                                      return res.status(response.status).json({
                                                                                                                                                                                                                                                              error: data?.error?.message || 'Anthropic request failed'
                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                        }

                                                                                                                                                                                                                                                                            const text =
                                                                                                                                                                                                                                                                                  data?.content?.map((x) => x?.text).filter(Boolean).join('\n').trim() || '';

                                                                                                                                                                                                                                                                                      return res.status(200).json({
                                                                                                                                                                                                                                                                                            response: text || 'لم يتم إنشاء رد.'
                                                                                                                                                                                                                                                                                                });
                                                                                                                                                                                                                                                                                                  } catch (err) {
                                                                                                                                                                                                                                                                                                      console.error('[api/assistant] unexpected error:', err);
                                                                                                                                                                                                                                                                                                          return res.status(500).json({
                                                                                                                                                                                                                                                                                                                error: err.message || 'Internal server error'
                                                                                                                                                                                                                                                                                                                    });
                                                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                                                                                      };