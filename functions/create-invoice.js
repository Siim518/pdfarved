const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
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

    // Create doc
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Add logo
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 100 });

    // Seller info
    doc.fontSize(10).text('Benaks OÜ', 400, 50)
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

    // TABLE HEADER
    doc.fontSize(10).text('Nimi', 50, doc.y, { width: 200 })
      .text('Kogus', 260, doc.y, { width: 40 })
      .text('Hind ilma KM', 320, doc.y, { width: 80 })
      .text('Hind koos KM', 420, doc.y, { width: 80 });

    // Horizontal line
    doc.moveTo(50, doc.y + 5).lineTo(500, doc.y + 5).stroke();
    doc.moveDown(0.5);

    let totalNet = 0;
    let totalGross = 0;

    // For each product
    products.forEach(p => {
      const netPriceEach = p.price_gross / 1.22;  // remove 22% VAT
      const lineNet = netPriceEach * p.qty;
      const lineGross = p.price_gross * p.qty;

      totalNet += lineNet;
      totalGross += lineGross;

      doc.text(p.name, 50, doc.y, { width: 200 })
         .text(p.qty.toString(), 260, doc.y, { width: 40 })
         .text(lineNet.toFixed(2) + ' €', 320, doc.y, { width: 80 })
         .text(lineGross.toFixed(2) + ' €', 420, doc.y, { width: 80 });

      doc.moveDown(0.5);
    });

    const vat = totalGross - totalNet; // should be totalNet * 0.22

    doc.moveDown(1);
    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (22%): ${vat.toFixed(2)} €`);
    doc.text(`Kokku koos KM: ${totalGross.toFixed(2)} €`);

    doc.moveDown(2);
    doc.text('Maksetähtaeg: 7 päeva', { align: 'left' });
    doc.text('Viivis: 0.05% päevas', { align: 'left' });

    doc.moveDown(2);
    doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171', { align: 'left' });

    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // Send Email
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

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Unknown error' })
    };
  }
};
