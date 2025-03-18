const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

exports.handler = async (event) => {
  try {
    // 1) Parse incoming form data
    const data = JSON.parse(event.body);
    const {
      arve_nr, saaja_nimi, saaja_firma, saaja_regnr, saaja_kmkr, saaja_aadress,
      products, email
    } = data;

    if (!Array.isArray(products) || products.length === 0) {
      throw new Error('No products provided');
    }
    if (!email) {
      throw new Error('No email provided');
    }

    // 2) Create PDF
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Optional: Add your logo
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 100 });

    doc.font('Helvetica').fontSize(10)
      .text('Benaks OÜ', 400, 50)
      .text('Reg.nr. 12069824')
      .text('KMKR nr. EE101433055')
      .text('Telefon: +372 5182792')
      .text('E-post: benaksinfo@gmail.com')
      .text('Hoburaua tee 8a, Randvere küla, Viimsi vald, Harju maakond, 74016');

    doc.moveDown(2);
    doc.fontSize(12).text(`ARVE NR: ${arve_nr || '-'}`);
    doc.moveDown(1);

    doc.fontSize(10).text(`Saaja nimi: ${saaja_nimi || '-'}`)
      .text(`Saaja firma: ${saaja_firma || '-'}`)
      .text(`Saaja reg.nr: ${saaja_regnr || '-'}`)
      .text(`Saaja KMKR: ${saaja_kmkr || '-'}`)
      .text(`Saaja aadress: ${saaja_aadress || '-'}`);

    doc.moveDown(2);

    // TABLE HEADER (Nimi, Kogus, Hind ilma KM, Hind koos KM)
    doc.font('Helvetica-Bold').fontSize(10);
    const headerY = doc.y;
    doc.text('Nimi', 50, headerY, { width: 150 });
    doc.text('Kogus', 210, headerY, { width: 50 });
    doc.text('Hind ilma KM', 270, headerY, { width: 100 });
    doc.text('Hind koos KM', 390, headerY, { width: 100 });

    doc.moveTo(50, headerY + 12).lineTo(500, headerY + 12).stroke();
    doc.y = headerY + 20;

    doc.font('Helvetica');
    let totalNet = 0;
    let totalGross = 0;

    products.forEach(p => {
      // net price (assuming 22% VAT => priceGross / 1.22)
      const netPriceEach = p.price_gross / 1.22;
      const lineNet = netPriceEach * p.qty;
      const lineGross = p.price_gross * p.qty;

      totalNet += lineNet;
      totalGross += lineGross;

      const rowY = doc.y;
      doc.text(p.name, 50, rowY, { width: 150 });
      doc.text(p.qty.toString(), 210, rowY, { width: 50 });
      doc.text(lineNet.toFixed(2) + ' €', 270, rowY, { width: 100 });
      doc.text(lineGross.toFixed(2) + ' €', 390, rowY, { width: 100 });

      doc.moveDown(1);
    });

    const vat = totalGross - totalNet;

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(500, doc.y).stroke();
    doc.moveDown(2);

    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);
    doc.text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    doc.moveDown(2);
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171');

    // Finalize PDF
    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // 3) Email invoice
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
      attachments: [{ filename: fileName, path: filePath }]
    });

    // 4) Upload to Google Drive => Invoices folder
    const folderId = '11-WG0xQwc21r_yTuBQXD-IiBNMwf8fXp'; // your folder ID
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

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
