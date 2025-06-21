const express = require('express');
const app = express();
const port = 3001;

app.get('/', (req, res) => {
  res.send('Simple server is running!');
});

app.listen(port, () => {
  console.log(`Simple server listening on port ${port}`);
});
