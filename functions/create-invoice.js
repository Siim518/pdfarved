// create-invoice.js
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
    // 1) Parse incoming form data from event.body
    const data = JSON.parse(event.body);
    const {
      arve_nr,
      saaja_nimi,
      saaja_firma,
      saaja_regnr,
      saaja_kmkr,
      saaja_aadress,
      products,
      email
    } = data;

    // Basic checks
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error('No products provided');
    }
    if (!email) {
      throw new Error('No email provided');
    }

    // 2) Create the PDF in /tmp/
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Minimal PDF example
    doc.fontSize(20).text(`ARVE NR: ${arve_nr}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Saaja nimi: ${saaja_nimi || '-'}`);
    doc.text(`Saaja firma: ${saaja_firma || '-'}`);
    doc.text(`Saaja reg.nr: ${saaja_regnr || '-'}`);
    doc.text(`Saaja KMKR: ${saaja_kmkr || '-'}`);
    doc.text(`Saaja aadress: ${saaja_aadress || '-'}`);
    doc.moveDown();
    doc.fontSize(12).text('Tooted:', { underline: true });

    let totalGross = 0;
    products.forEach((p) => {
      const lineTotal = (p.price_gross || 0) * (p.qty || 1);
      totalGross += lineTotal;
      doc.fontSize(10).text(`- ${p.name} (kogus: ${p.qty}), hind: ${p.price_gross} EUR => ${lineTotal.toFixed(2)} EUR`);
    });

    doc.moveDown();
    doc.fontSize(12).text(`Kokku: ${totalGross.toFixed(2)} EUR (koos KM)`);

    doc.end();
    // Wait for PDF write to finish
    await new Promise((resolve) => writeStream.on('finish', resolve));

    // 3) Upload PDF to Google Drive
    // Folder link => https://drive.google.com/drive/folders/13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO
    // => folderId = '13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO'
    const folderId = '13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO';
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    const drive = google.drive({ version: 'v3', auth });

    await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/pdf',
        parents: [folderId]
      },
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      }
    });

    // 4) Send the PDF via Gmail
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `Benaks OÜ <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Arve ${arve_nr || '-'}`,
      text: 'Arve on lisatud manusena.',
      attachments: [
        {
          filename: fileName,
          path: filePath
        }
      ]
    });

    // 5) Return success as JSON
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    // **Return valid JSON** on error
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
