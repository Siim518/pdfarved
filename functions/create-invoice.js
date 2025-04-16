const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
    // 1) Parse form data
    const data = JSON.parse(event.body);
    const {
      arve_nr, saaja_nimi, saaja_firma, saaja_regnr, saaja_kmkr, saaja_aadress,
      products, email
    } = data;

    // Basic checks
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error('No products provided');
    }
    if (!email) {
      throw new Error('No email provided');
    }

    // NEW: Build date string (dd-mm-yyyy)
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}-${month}-${year}`;

    // 2) Create PDF in /tmp
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // -- LOGO + TWO COLUMN LAYOUT --
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 80 });

    // We'll start both columns at y=140
    const topOfColumns = 140;

    // Left column: Seller info
    doc.fontSize(10);

    // Bold "Benaks OÜ"
    doc.font('Helvetica-Bold').text('Benaks OÜ', 50, topOfColumns, { width: 200 });
    // Switch back to normal
    doc.font('Helvetica');

    // Print the rest of the info below
    doc.text(
      `Reg.nr. 12069824
KMKR nr. EE101433055
Telefon: +372 5182792
E-post: benaksinfo@gmail.com
Hoburaua tee 8a, Randvere küla,
Viimsi vald, Harju maakond, 74016`,
      50,
      doc.y,
      { width: 200 }
    );
    const finalSellerY = doc.y;

    // Right column: ARVE NR + client info
    let clientX = 300;
    let clientY = topOfColumns;

    // **Bold 18pt** for ARVE NR
    doc.font('Helvetica-Bold').fontSize(18)
       .text(`ARVE NR: ${arve_nr || '-'}`, clientX, clientY);
    // Move down more for bigger text
    clientY += 24;

    // Normal for the rest of client info
    doc.font('Helvetica').fontSize(10);
    doc.text(`Saaja nimi: ${saaja_nimi || '-'}`, clientX, clientY);    clientY += 14;
    doc.text(`Saaja firma: ${saaja_firma || '-'}`, clientX, clientY); clientY += 14;
    doc.text(`Saaja reg.nr: ${saaja_regnr || '-'}`, clientX, clientY); clientY += 14;
    doc.text(`Saaja KMKR: ${saaja_kmkr || '-'}`, clientX, clientY);    clientY += 14;
    doc.text(`Saaja aadress: ${saaja_aadress || '-'}`, clientX, clientY); clientY += 14;

    const finalClientY = clientY;
    doc.y = Math.max(finalSellerY, finalClientY) + 30;

    // -- TABLE HEADERS --
    const headingY = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Nimi',         50, headingY, { width: 150 });
    doc.text('Kogus',        210, headingY, { width: 50 });
    doc.text('Hind ilma KM', 270, headingY, { width: 100 });
    doc.text('Hind koos KM', 390, headingY, { width: 100 });

    doc.moveTo(50, headingY + 12).lineTo(500, headingY + 12).stroke();
    doc.y = headingY + 20;

    // Switch back to normal for product rows
    doc.font('Helvetica').fontSize(10);

    let totalNet = 0;
    let totalGross = 0;

    // Multi-line fix for product rows
    products.forEach(p => {
      const rowStart = doc.y;

      const nameHeight = doc.heightOfString(p.name, { width: 150 });

      const netEach = p.price_gross / 1.22;
      const lineNet = netEach * p.qty;
      const lineGross = p.price_gross * p.qty;
      totalNet += lineNet;
      totalGross += lineGross;

      doc.text(p.name,       50, rowStart, { width: 150 });
      doc.text(String(p.qty),210, rowStart, { width: 50 });
      doc.text(`${lineNet.toFixed(2)} €`,   270, rowStart, { width: 100 });
      doc.text(`${lineGross.toFixed(2)} €`, 390, rowStart, { width: 100 });

      doc.y = rowStart + nameHeight + 4; // small gap
    });

    const vat = totalGross - totalNet;

    doc.moveDown(1);
    const lineY = doc.y;
    doc.moveTo(50, lineY).lineTo(500, lineY).stroke();
    doc.moveDown(1);

    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);

    // BOLD for "Kokku koos KM"
    doc.font('Helvetica-Bold').fontSize(10)
       .text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    // Switch back to normal
    doc.font('Helvetica').fontSize(10);

    // Move down a bit
    doc.moveDown(2);

    // NEW: Print the date above Maksetähtaeg
    doc.text(`Arve kuupäev: ${dateStr}`);

    // Then the rest
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9)
       .text('Benaks OÜ IBAN: EE832200221051880171');

    // finalize PDF
    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // 4) Upload to Google Drive (with metadata)
    const folderId = '13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO';
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    const drive = google.drive({ version: 'v3', auth });

    const metaObj = { invoiceNr: arve_nr, name: saaja_nimi, email };
    await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'application/pdf',
        parents: [folderId],
        description: JSON.stringify(metaObj)
      },
      media: {
        mimeType: 'application/pdf',
        body: fs.createReadStream(filePath)
      }
    });

    // 5) Send Email
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

    // Done
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
