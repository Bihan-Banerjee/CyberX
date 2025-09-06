import express from 'express';
import scanRouter from './routes/scan.js';

const app = express();
app.use(express.json());            // parse JSON bodies
app.use('/api', scanRouter);        // POST /api/scan

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
