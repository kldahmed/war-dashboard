end();
  });
  }

  module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
              res.statusCode = 200;
                  res.end();
                      return;
                        }

                          if (req.method !== 'POST') {
                              res.statusCode = 405;
                                  res.setHeader('Content-Type', 'application/json; charset=utf-8');
                                      res.end(JSON.stringify({ error: 'Method not allowed' }));
                                          return;
                                            }

                                              try {  
                                                  const body =
                                                        req.body && typeof req.body === 'object'
                                                                ? req.body
                                                                        : await readJsonBody(req);

                                                                            const message = String(body?.message || '').trim();
                                                                                const context = String(body?.context || '').trim();

                                                                                    if (!message) {
                                                                                          res.statusCode = 400;
                                                                                                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                                                                                                      res.end(JSON.stringify({ error: 'message required' }));
                                                                                                            return;
                                                                                                                }

                                                                                                                    const prompt = context
                                                                                                                          ? `السياق الإخباري:\n${context}\n\nالسؤال:\n${message}`
                                                                                                                                : message;

                                                                                                                                    const reply = await callOpenRouter(prompt);

                                                                                                                                        res.statusCode = 200;
                                                                                                                                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                                                                                                                                                res.end(
                                                                                                                                                      JSON.stringify({
                                                                                                                                                              response: reply
                                                                                                                                                                    })
                                                                                                                                                                        );
                                                                                                                                                                          } catch (err) {
                                                                                                                                                                              console.error('[api/assistant] error:', err);

                                                                                                                                                                                  res.statusCode = 500;
                                                                                                                                                                                      res.setHeader('Content-Type', 'application/json; charset=utf-8');
                                                                                                                                                                                          res.end(
                                                                                                                                                                                                JSON.stringify({
                                                                                                                                                                                                        error: err.message || 'Internal server error'
                                                                                                                                                                                                              })
                                                                                                                                                                                                                  );
                                                                                                                                                                                                                    }
                                                                                                                                                                                                                    };