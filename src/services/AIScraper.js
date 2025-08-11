require('dotenv').config();

const puppeteer = require('puppeteer');
const axios = require('axios');

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

class AIScraper {
    constructor() {
        this.browser = null;
    }

    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor'
                ]
            });
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    // Content extraction using Deepseek
    async extractWithAI(htmlContent) {
        try {
            const prompt = `
                You are an expert web scraper. Extract product information from this eBay search results HTML.
                Return a JSON array of products with the following structure:
                {
                "products": [
                    {
                    "name": "product name",
                    "price": "price with currency symbol",
                    "link": "product detail page URL",
                    "imageUrl": "main product image URL"
                    }
                ]
                }

                Rules:
                - Extract ALL products from the page
                - If any field is missing or empty, use "-"
                - Ensure URLs are complete (add https://www.ebay.com if needed)
                - Only return valid JSON, no additional text

                HTML Content:
                ${htmlContent.substring(0, 15000)} // Truncate to avoid token limits
                `;

            const response = await axios.post(DEEPSEEK_API_URL, {
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 2000
            }, {
                headers: {
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const aiResponse = response.data.choices[0].message.content;

            // Clean and parse JSON response
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }

            throw new Error('Invalid JSON response from AI');

        } catch (error) {
            console.error('AI extraction error:', error);
            return  { products: [] };
        }
    }

    // Fallback extraction method
    async extractProductsFallback(page) {
        try {
            return await page.evaluate(() => {
                const products = [];

                // Common eBay selectors
                const productSelectors = [
                    '.s-item',
                    '.srp-results .s-item',
                    '[data-testid="item-cell"]'
                ];

                let productElements = [];
                for (const selector of productSelectors) {
                    productElements = document.querySelectorAll(selector);
                    if (productElements.length > 0) break;
                }

                productElements.forEach(item => {
                    try {
                        // Extract name
                        const nameElement = item.querySelector('.s-item__title, .s-item__link, h3, [data-testid="item-title"]');
                        const name = nameElement ? nameElement.textContent.trim() : '-';

                        // Extract price
                        const priceElement = item.querySelector('.s-item__price, .notranslate, [data-testid="item-price"]');
                        const price = priceElement ? priceElement.textContent.trim() : '-';

                        // Extract link
                        const linkElement = item.querySelector('a, .s-item__link');
                        const link = linkElement ? linkElement.href : '-';

                        // Extract image
                        const imageElement = item.querySelector('img');
                        const imageUrl = imageElement ? imageElement.src : '-';

                        if (name !== '-' && !name.includes('Shop on eBay')) {
                            products.push({ name, price, link, imageUrl });
                        }
                    } catch (err) {
                        console.error('Error extracting product:', err);
                    }
                });

                return products;
            });
        } catch (error) {
            console.error('Fallback extraction failed:', error);
            return [];
        }
    }

    async scrapeProductDetails(productUrl) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();

        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            const htmlContent = await page.content();

            // Try AI extraction first
            if (DEEPSEEK_API_KEY) {
                const aiResult = await this.extractWithAI(htmlContent);
                if (aiResult.description && aiResult.description !== '-') {
                    return aiResult.description;
                }
            }

            // Fallback to manual extraction
            const description = await page.evaluate(() => {
                const descriptionSelectors = [
                    '#x-item-description-label + div',
                    '.x-item-description',
                    '.item-description',
                    '[data-testid="x-item-description-label"] + div',
                    '.u-flL.condText'
                ];

                for (const selector of descriptionSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        return element.textContent.trim();
                    }
                }
                return '-';
            });

            return description || '-';

        } catch (error) {
            console.error('Error scraping product details:', error);
            return '-';
        } finally {
            await page.close();
        }
    }

    async scrapeProducts(url, maxPages = 5) {
        const browser = await this.initBrowser();
        const allProducts = [];
        let currentPage = 1;

        try {
            while (currentPage <= maxPages) {
                console.log(`Scraping page ${currentPage}...`);

                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

                const pageUrl = url.replace('_pgn=1', `_pgn=${currentPage}`);

                try {
                    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const htmlContent = await page.content();
                    let products = [];

                    // Try AI extraction first
                    if (DEEPSEEK_API_KEY) {
                        const aiResult = await this.extractWithAI(htmlContent, 'listing');
                        products = aiResult.products || [];
                    }

                    // Fallback to manual extraction if AI fails
                    if (products.length === 0) {
                        products = await this.extractProductsFallback(page);
                    }

                    if (products.length === 0) {
                        console.log('No more products found, stopping pagination');
                        await page.close();
                        break;
                    }

                    // Get detailed descriptions for each product
                    for (let i = 0; i < products.length; i++) {
                        const product = products[i];
                        if (product.link && product.link !== '-') {
                            console.log(`Getting description for product ${i + 1}/${products.length}`);
                            product.description = await this.scrapeProductDetails(product.link);
                        } else {
                            product.description = '-';
                        }
                    }

                    allProducts.push(...products);
                    console.log(`Found ${products.length} products on page ${currentPage}`);

                    currentPage++;
                    await page.close();

                    // Add delay between pages
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (pageError) {
                    console.error(`Error on page ${currentPage}:`, pageError);
                    await page.close();
                    break;
                }
            }

        } catch (error) {
            console.error('Scraping error:', error);
        }

        return allProducts;
    }
}

module.exports = AIScraper;