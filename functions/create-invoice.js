const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

exports.handler = async (event) => {
  try {
    const data = JSON.parse(event.body);

    // Fields
    const {
      arve_nr, saaja_nimi, saaja_firma, saaja_regnr, saaja_kmkr, saaja_aadress,
      products_text, email
    } = data;

    if (!products_text || products_text.trim() === '') {
      throw new Error('Products text is empty');
    }

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Logo
    const logoPath = path.join(__dirname, 'benaks-logo.png');
    doc.image(logoPath, 50, 50, { width: 100 });

    // We'll keep default PDFKit font = Helvetica
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

    doc.fontSize(10).text('Tooted:', 50, doc.y);
    doc.moveDown(0.5);
    doc.text(products_text, { width: 500 });

    doc.moveDown(2);
    doc.text('Maksetähtaeg: 7 päeva', { align: 'left' });
    doc.text('Viivis: 0.05% päevas', { align: 'left' });

    doc.moveDown(2);
    doc.fontSize(9).text('Benaks OÜ IBAN: EE832200221051880171', { align: 'left' });

    doc.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    // Send email
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
