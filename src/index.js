require('dotenv').config();

const express = require('express');
const AIScraper = require('./services/AIScraper')

const app = express();

// Enhanced JSON parsing with better error handling
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Add error handling middleware for JSON parsing
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({
            error: 'Invalid JSON format in request body',
            message: 'Please check your JSON syntax and try again'
        });
    }
    next();
});

// Deepseek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// API Routes
app.post('/scrape', async (req, res) => {
    try {
        const { url, maxPages = 3 } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        if (!DEEPSEEK_API_KEY) {
            console.warn('DEEPSEEK_API_KEY not set, using fallback extraction');
        }

        const scraper = new AIScraper();

        console.log('Starting scraping process...');
        const products = await scraper.scrapeProducts(url, maxPages);

        await scraper.closeBrowser();

        res.json({
            success: true,
            totalProducts: products.length,
            products: products.map(product => ({
                name: product.name || '-',
                price: product.price || '-',
                description: product.description || '-',
                link: product.link || '-',
                imageUrl: product.imageUrl || '-'
            }))
        });

    } catch (error) {
        console.error('API error:', error);
        res.status(500).json({
            error: 'Scraping failed',
            message: error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`AI Scraper API running on port ${PORT}`);
});

module.exports = app;