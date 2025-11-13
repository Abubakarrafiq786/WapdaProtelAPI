const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');
const PersonalDetail = require('../models/PersonDetail');
const { protect } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const viewScreenshot = (screenshotPath) => {
    if (fs.existsSync(screenshotPath)) {
        console.log(`Screenshot exists at: ${screenshotPath}`);
        
        const { exec } = require('child_process');
        
        exec(`start "" "${screenshotPath}"`);
        
        return true;
    } else {
        console.log('Screenshot file not found');
        return false;
    }
};

const listSavedBills = () => {
    const billsFolder = path.join(__dirname, '../bills');
    
    if (fs.existsSync(billsFolder)) {
        const files = fs.readdirSync(billsFolder);
        console.log('Saved bills:');
        files.forEach(file => {
            console.log(`- ${file}`);
        });
        return files;
    } else {
        console.log('Bills folder does not exist');
        return [];
    }
};

router.post('/check-bill', protect, async (req, res) => {
    const userId = req.user._id;
    let browser = null;

    try {
        const userDetail = await PersonalDetail.findOne({ userId });

        if (!userDetail) {
            return res.status(404).json({
                success: false,
                message: 'User details not found'
            });
        }

        const customerNumber = userDetail.ReferanceNo;
        if (!customerNumber) {
            return res.status(404).json({
                success: false,
                message: 'Reference number missing for this user'
            });
        }

        browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720'],
            defaultViewport: null
        });

        const page = await browser.newPage();
        
        console.log('Opening browser and navigating to bill website...');
        
        await page.goto('https://bill.pitc.com.pk/mepcobill', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        console.log('Website loaded successfully');

        await page.waitForSelector('input[name="searchTextBox"]', { timeout: 15000 });
        console.log('Input field found, filling customer number...');
        
        await page.type('input[name="searchTextBox"]', customerNumber, { delay: 100 });
        console.log(`Customer number ${customerNumber} filled`);

        await new Promise(resolve => setTimeout(resolve, 20000));

        console.log('Clicking search button...');
        await page.click('input[type="submit"], button[type="submit"], input[value="Search"]');
        
        console.log('Search button clicked, waiting for results...');

        await new Promise(resolve => setTimeout(resolve, 20000));

        const currentUrl = await page.url();
        const pageTitle = await page.title();
        
        console.log('Current URL:', currentUrl);
        console.log('Page Title:', pageTitle);

        const screenshotBuffer = await page.screenshot({ encoding: 'binary', fullPage:true });
        const screenshotBase64 = screenshotBuffer.toString('base64');
        
        const billsFolder = path.join(__dirname, '../bills');
        
        if (!fs.existsSync(billsFolder)) {
            fs.mkdirSync(billsFolder, { recursive: true });
            console.log('Bills folder created');
        }

        const filename = `bill_${customerNumber}_${Date.now()}.png`;
        const filePath = path.join(billsFolder, filename);
        
        fs.writeFileSync(filePath, screenshotBuffer);
        console.log(`Screenshot saved to: ${filePath}`);

        if (fs.existsSync(filePath)) {
            console.log('✅ Screenshot successfully saved at:', filePath);
            viewScreenshot(filePath); 
        }

        listSavedBills();

        setTimeout(async () => {
            await browser.close();
            console.log('Browser closed');
        }, 5000);

        res.json({
            success: true,
            message: 'Bill check completed successfully',
            data: {
                userId: userId,
                customerNumber: customerNumber,
                pageTitle: pageTitle,
                currentUrl: currentUrl,
                screenshot: screenshotBase64,
                screenshotPath: filePath, 
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        if (browser) {
            setTimeout(async () => {
                await browser.close();
            }, 10000);
        }
        
        console.error('Error in bill check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check bill',
            error: error.message
        });
    }
});

router.post('/check-bill-detailed', protect, async (req, res) => {
    const userId = req.user._id;
    let browser = null;

    try {
        const userDetail = await PersonalDetail.findOne({ userId });

        if (!userDetail) {
            return res.status(404).json({
                success: false,
                message: 'User details not found'
            });
        }

        const customerNumber = userDetail.ReferanceNo;
        if (!customerNumber) {
            return res.status(404).json({
                success: false,
                message: 'Reference number missing for this user'
            });
        }

        console.log(`Starting bill check for user ${userId} with reference ${customerNumber}`);

        browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--start-maximized',
                '--disable-dev-shm-usage'
            ],
            defaultViewport: null
        });

        const pages = await browser.pages();
        const page = pages[0] || await browser.newPage();

        console.log('Step 1: Navigating to bill website...');
        await page.goto('https://bill.pitc.com.pk/mepcobill', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        console.log('Step 2: Waiting for page to load...');
        await new Promise(r => setTimeout(r, 3000));

        console.log('Step 3: Looking for input field...');
        
        const inputSelectors = [
            'input[type="text"]',
            'input[name*="searchTextBox"]',
            'input[name*="text"]',
            'input[placeholder*="number" i]',
            'input[placeholder*="customer" i]',
            'input[placeholder*="reference" i]',
            'input[placeholder*="enter" i]',
            '#searchTextBox',
            '#txtSearch',
            '#customerNumber',
            '#searchTextBox',
            '.form-control',
            '.search-box',
            'input'
        ];

        let inputField = null;
        let foundInputSelector = null;

        for (const selector of inputSelectors) {
            try {
                inputField = await page.$(selector);
                if (inputField) {
                    console.log(`Found input field with selector: ${selector}`);
                    foundInputSelector = selector;
                    break;
                }
            } catch (err) {
                continue;
            }
        }

        if (!inputField) {
            const allInputs = await page.$$('input');
            console.log('Available input fields on page:');
            for (const input of allInputs) {
                const inputType = await page.evaluate(el => el.type, input);
                const inputName = await page.evaluate(el => el.name, input);
                const inputId = await page.evaluate(el => el.id, input);
                const inputPlaceholder = await page.evaluate(el => el.placeholder, input);
                console.log(`- Type: ${inputType}, Name: ${inputName}, ID: ${inputId}, Placeholder: ${inputPlaceholder}`);
            }
            throw new Error('Could not find input field on the page');
        }

        console.log(`Step 4: Filling customer number: ${customerNumber}`);
        await page.click(foundInputSelector);
        await page.evaluate((selector) => {
            document.querySelector(selector).value = '';
        }, foundInputSelector);
        
        await page.type(foundInputSelector, customerNumber, { delay: 100 });
        console.log(`Customer number filled successfully`);

        console.log('Step 5: Searching for Search button...');
        await page.waitForSelector('#btnSearch', { visible: true, timeout: 20000 });

        await page.evaluate(() => {
            const btn = document.querySelector('#btnSearch');
            if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        const beforeClickScreenshot = await page.screenshot({ encoding: 'base64' });

        try {
            await page.click('#btnSearch', { delay: 100 });
            console.log('✅ Clicked using Puppeteer .click()');
        } catch (err) {
            console.log('⚠️ Normal click failed, trying JS-based click...');
            await page.evaluate(() => {
                const btn = document.querySelector('#btnSearch');
                if (btn) btn.click();
            });
            console.log('✅ Clicked using JavaScript evaluate()');
        }

        console.log('Step 6: Waiting for results...');
        await new Promise(r => setTimeout(r, 5000)); 
        const finalUrl = await page.url();
        const finalTitle = await page.title();
        const afterSearchScreenshot = await page.screenshot({ encoding: 'base64' });

        const billsFolder = path.join(__dirname, '../bills');
        if (!fs.existsSync(billsFolder)) {
            fs.mkdirSync(billsFolder, { recursive: true });
        }

        const filename = `bill_detailed_${customerNumber}_${Date.now()}.png`;
        const filePath = path.join(billsFolder, filename);
        const afterSearchBuffer = Buffer.from(afterSearchScreenshot, 'base64');
        fs.writeFileSync(filePath, afterSearchBuffer);
        
        console.log(`✅ Detailed screenshot saved to: ${filePath}`);
        viewScreenshot(filePath);

        const searchSuccess = !finalUrl.includes('mepcobill') || finalTitle.toLowerCase().includes('bill') || finalTitle.toLowerCase().includes('result');

        setTimeout(async () => {
            await browser.close();
            console.log('Browser closed after 1 minute');
        }, 60000);

        res.json({
            success: true,
            message: 'Bill check completed successfully',
            data: {
                userId: userId,
                customerNumber: customerNumber,
                pageTitle: finalTitle,
                currentUrl: finalUrl,
                searchSuccessful: searchSuccess,
                buttonClicked: 'btnSearch',
                screenshots: {
                    before: beforeClickScreenshot,
                    after: afterSearchScreenshot
                },
                screenshotPath: filePath,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Detailed error in bill check:', error);
        
        if (browser) {
            console.log('Keeping browser open for 20 seconds for debugging...');
            setTimeout(async () => {
                await browser.close();
                console.log('Browser closed after error');
            }, 20000);
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to check bill',
            error: error.message,
            details: 'Check the server logs for more information'
        });
    }
});

router.get('/reference-number/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;

        const userDetail = await PersonalDetail.findOne({ userId: userId });
        
        if (!userDetail) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const referenceNumber = userDetail.ReferanceNo;
        
        if (!referenceNumber) {
            return res.status(404).json({
                success: false,
                message: 'Reference number not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId: userId,
                referenceNumber: referenceNumber,
                userName: userDetail.name || 'N/A'
            }
        });

    } catch (error) {
        console.error('Error fetching reference number:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reference number',
            error: error.message
        });
    }
});

router.get('/my-reference-number', protect, async (req, res) => {
    try {
        const userId = req.user._id;

        const userDetail = await PersonalDetail.findOne({ userId });
        
        if (!userDetail) {
            return res.status(404).json({
                success: false,
                message: 'User details not found'
            });
        }

        const referenceNumber = userDetail.ReferanceNo;
        
        if (!referenceNumber) {
            return res.status(404).json({
                success: false,
                message: 'Reference number not found for your account'
            });
        }

        res.json({
            success: true,
            data: {
                userId: userId,
                referenceNumber: referenceNumber,
                userName: userDetail.name || 'N/A'
            }
        });

    } catch (error) {
        console.error('Error fetching reference number:', error);
        
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reference number',
            error: error.message
        });
    }
});

// Route to view a specific screenshot
router.get('/view-screenshot/:filename', (req, res) => {
    const billsFolder = path.join(__dirname, '../bills');
    const filename = req.params.filename;
    const filePath = path.join(billsFolder, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({
            success: false,
            message: 'Screenshot not found'
        });
    }
});

// Route to list all saved bills
router.get('/saved-bills', (req, res) => {
    const billsFolder = path.join(__dirname, '../bills');
    
    if (fs.existsSync(billsFolder)) {
        const files = fs.readdirSync(billsFolder);
        res.json({
            success: true,
            bills: files
        });
    } else {
        res.json({
            success: true,
            bills: [],
            message: 'No bills folder found'
        });
    }
});

// Route to open/view a specific bill screenshot
router.get('/open-bill/:filename', (req, res) => {
    const billsFolder = path.join(__dirname, '../bills');
    const filename = req.params.filename;
    const filePath = path.join(billsFolder, filename);
    
    if (fs.existsSync(filePath)) {
        try {
            viewScreenshot(filePath);
            res.json({
                success: true,
                message: `Opening screenshot: ${filename}`,
                filePath: filePath
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Failed to open screenshot',
                error: error.message
            });
        }
    } else {
        res.status(404).json({
            success: false,
            message: 'Screenshot not found'
        });
    }
});
router.post('/download-bill-pdf', protect, async (req, res) => {
    const userId = req.user._id;
    let browser = null;

    try {
        const userDetail = await PersonalDetail.findOne({ userId });
        if (!userDetail || !userDetail.ReferanceNo) {
            return res.status(404).json({
                success: false,
                message: 'User details or reference number not found'
            });
        }

        const customerNumber = userDetail.ReferanceNo;

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });

        const page = await browser.newPage();
        
        // Set longer timeouts
        page.setDefaultTimeout(60000);
        page.setDefaultNavigationTimeout(60000);

        console.log('🚀 Navigating to bill website...');
        
        await page.goto('https://bill.pitc.com.pk/mepcobill', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        console.log('✅ Website loaded');

        // Wait for and fill the search input
        await page.waitForSelector('input[name="searchTextBox"]', { timeout: 30000 });
        await page.type('input[name="searchTextBox"]', customerNumber, { delay: 50 });
        console.log(`🔢 Customer number filled: ${customerNumber}`);

        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('🔍 Clicking search button...');

        // Strategy 1: Try with navigation wait
        try {
            await Promise.all([
                page.click('input[type="submit"], input[id="btnSearch"], input[value="btnSearch"]'),
                page.waitForNavigation({ 
                    waitUntil: 'networkidle0', 
                    timeout: 45000 
                })
            ]);
            console.log('✅ Navigation completed');
        } catch (navError) {
            console.log('⚠️ No navigation detected, using alternative waiting strategy...');
            
            // Strategy 2: Just click and wait for content changes
            await page.click('input[type="submit"], button[type="submit"], input[value="Search"]');
            
            // Wait for any network requests to complete
            await page.waitForNetworkIdle({ timeout: 30000 });
            
            // Wait for potential content updates
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Check if page content changed
            const contentChanged = await page.evaluate(() => {
                return document.body.innerHTML.length > 1000; // Basic check
            });
            
            if (!contentChanged) {
                console.log('⚠️ Page content may not have updated');
            }
        }

        // Final wait for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 5000));

        const currentUrl = page.url();
        const pageTitle = await page.title();
        
        console.log('📄 Current URL:', currentUrl);
        console.log('🏷️ Page Title:', pageTitle);

        // Take a screenshot for debugging
        const screenshotPath = path.join(__dirname, '../bills/pdf');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('📸 Debug screenshot saved');

        // Generate PDF
        const pdfsFolder = path.join(__dirname, '../bills/pdfs');
        if (!fs.existsSync(pdfsFolder)) {
            fs.mkdirSync(pdfsFolder, { recursive: true });
        }

        const pdfFilename = `bill_${customerNumber}_${Date.now()}.pdf`;
        const pdfPath = path.join(pdfsFolder, pdfFilename);

        console.log('📊 Generating PDF...');
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
            displayHeaderFooter: true,
            headerTemplate: `
                <div style="font-size: 10px; margin-left: 20px; font-family: Arial;">
                    MEPCO Bill | Generated: <span class="date"></span>
                </div>
            `,
            footerTemplate: `
                <div style="font-size: 8px; text-align: center; width: 100%; font-family: Arial;">
                    Customer: ${customerNumber} | Page <span class="pageNumber"></span> of <span class="totalPages"></span>
                </div>
            `,
            timeout: 30000
        });

        fs.writeFileSync(pdfPath, pdfBuffer);
        console.log(`💾 PDF saved: ${pdfPath}`);

        await browser.close();

        // Send response
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        
        res.send(pdfBuffer);
        console.log(`✅ PDF delivered for customer: ${customerNumber}`);

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        
        console.error('❌ PDF generation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate PDF bill',
            error: error.message,
            suggestion: 'The bill search might be taking longer than expected. Please try again.'
        });
    }
});

router.get('/view-latest-pdf', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        
        // Get user details
        const userDetail = await PersonalDetail.findOne({ userId });
        if (!userDetail || !userDetail.ReferanceNo) {
            return res.status(404).json({
                success: false,
                message: 'User details or reference number not found'
            });
        }

        const customerNumber = userDetail.ReferanceNo;
        const pdfsFolder = path.join(__dirname, '../bills/pdfs');

        if (!fs.existsSync(pdfsFolder)) {
            return res.status(404).json({
                success: false,
                message: 'No PDFs found'
            });
        }

        // Find latest PDF for this customer
        const allFiles = fs.readdirSync(pdfsFolder);
        const userPdfs = allFiles.filter(file => 
            file.startsWith(`bill_${customerNumber}_`) && file.endsWith('.pdf')
        );

        if (userPdfs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No PDFs found for your account'
            });
        }

        // Get the most recent PDF
        const latestPdf = userPdfs.reduce((latest, filename) => {
            const timestampMatch = filename.match(/_(\d+)\.pdf$/);
            if (timestampMatch) {
                const fileTimestamp = parseInt(timestampMatch[1]);
                const latestTimestamp = latest.timestamp || 0;
                
                if (fileTimestamp > latestTimestamp) {
                    return { filename, timestamp: fileTimestamp };
                }
            }
            return latest;
        }, { filename: userPdfs[0], timestamp: 0 });

        const pdfPath = path.join(pdfsFolder, latestPdf.filename);
        
        if (!fs.existsSync(pdfPath)) {
            return res.status(404).json({
                success: false,
                message: 'PDF file not found'
            });
        }

        const stats = fs.statSync(pdfPath);
        const fileSize = stats.size;
        const pdfDate = new Date(latestPdf.timestamp);

        console.log(`🔍 Serving latest PDF for ${customerNumber}: ${latestPdf.filename}`);

        // Set headers for PDF viewing
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${latestPdf.filename}"`);
        res.setHeader('Content-Length', fileSize);
        res.setHeader('X-PDF-Date', pdfDate.toISOString());
        res.setHeader('X-Customer-Number', customerNumber);
        res.setHeader('Cache-Control', 'no-cache');

        // Stream the PDF file
        const fileStream = fs.createReadStream(pdfPath);
        fileStream.pipe(res);

    } catch (error) {
        console.error('Error serving latest PDF:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to serve PDF file',
            error: error.message
        });
    }
});
module.exports = router;