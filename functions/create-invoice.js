const PDFDocument = require('pdfkit');
const nodemailer  = require('nodemailer');
const { google }  = require('googleapis');
const fs          = require('fs');
const path        = require('path');

exports.handler = async (event) => {
  try {
    /* ------------------------------------------------------------
       0.  Parse incoming JSON
    ------------------------------------------------------------ */
    const data = JSON.parse(event.body);
    const {
      arve_nr, saaja_nimi, saaja_firma, saaja_regnr, saaja_kmkr, saaja_aadress,
      products, email
    } = data;

    if (!Array.isArray(products) || products.length === 0)
      throw new Error('No products provided');
    if (!email)
      throw new Error('No email provided');

    /* ------------------------------------------------------------
       1.  Constants for the new VAT
    ------------------------------------------------------------ */
    const VAT_RATE   = 0.24;          // 24 %
    const VAT_FACTOR = 1 + VAT_RATE;  // 1.24 for net ⇐ gross

    /* ------------------------------------------------------------
       2.  Today’s date string  (dd-mm-yyyy)
    ------------------------------------------------------------ */
    const now   = new Date();
    const dateStr =
      `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

    /* ------------------------------------------------------------
       3.  Create PDF
    ------------------------------------------------------------ */
    const doc      = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${arve_nr || 'no-number'}.pdf`;
    const filePath = `/tmp/${fileName}`;
    const stream   = fs.createWriteStream(filePath);
    doc.pipe(stream);

    /*  -- LOGO & columns -------------------------------------------------- */
    doc.image(path.join(__dirname, 'benaks-logo.png'), 50, 50, { width: 80 });

    /* Seller column (left) */
    const topY = 140;
    doc.fontSize(10).font('Helvetica-Bold')
       .text('Benaks OÜ', 50, topY, { width: 200 })
       .font('Helvetica')
       .text(
`Reg.nr. 12069824
KMKR nr. EE101433055
Telefon: +372 5182792
E-post: benaksinfo@gmail.com
Hoburaua tee 8a, Randvere küla,
Viimsi vald, Harju maakond, 74016`,
        50, doc.y, { width: 200 });

    const leftEndY = doc.y;

    /* Client column (right) */
    let cx = 300, cy = topY;
    doc.font('Helvetica-Bold').fontSize(18)
       .text(`ARVE NR: ${arve_nr || '-'}`, cx, cy);
    cy += 24;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Saaja nimi: ${saaja_nimi || '-'}`,  cx, cy); cy += 14;
    doc.text(`Saaja firma: ${saaja_firma || '-'}`,cx, cy); cy += 14;
    doc.text(`Saaja reg.nr: ${saaja_regnr || '-'}`,cx, cy); cy += 14;
    doc.text(`Saaja KMKR: ${saaja_kmkr || '-'}`,  cx, cy); cy += 14;
    doc.text(`Saaja aadress: ${saaja_aadress || '-'}`, cx, cy); cy += 14;

    doc.y = Math.max(leftEndY, cy) + 30;

    /* -- Table headers ---------------------------------------------------- */
    const hY = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('Nimi',          50, hY, { width: 150 });
    doc.text('Kogus',         210, hY, { width: 50  });
    doc.text('Hind ilma KM',  270, hY, { width: 100 });
    doc.text('Hind koos KM',  390, hY, { width: 100 });
    doc.moveTo(50, hY + 12).lineTo(500, hY + 12).stroke();
    doc.y = hY + 20;
    doc.font('Helvetica');

    /* -- Product rows ----------------------------------------------------- */
    let totalNet = 0, totalGross = 0;

    products.forEach(p => {
      const rowY = doc.y;
      const nameHeight = doc.heightOfString(p.name, { width: 150 });

      const netEach   = p.price_gross / VAT_FACTOR;   // divide by 1.24
      const lineNet   = netEach * p.qty;
      const lineGross = p.price_gross * p.qty;

      totalNet   += lineNet;
      totalGross += lineGross;

      doc.text(p.name,        50, rowY, { width: 150 });
      doc.text(String(p.qty), 210, rowY, { width: 50  });
      doc.text(`${lineNet.toFixed(2)} €`,   270, rowY, { width: 100 });
      doc.text(`${lineGross.toFixed(2)} €`, 390, rowY, { width: 100 });

      doc.y = rowY + nameHeight + 4;
    });

    /* -- Totals & footer -------------------------------------------------- */
    const vat = totalGross - totalNet;

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(500, doc.y).stroke();
    doc.moveDown(1);

    doc.text(`Kokku ilma KM: ${totalNet.toFixed(2)} €`);
    doc.text(`KM (24%): ${vat.toFixed(2)} €`);
    doc.font('Helvetica-Bold')
       .text(`Kokku koos KM: ${totalGross.toFixed(2)} €`)
       .font('Helvetica');

    doc.moveDown(2);
    doc.text(`Arve kuupäev: ${dateStr}`);
    doc.text('Maksetähtaeg: 7 päeva');
    doc.text('Viivis: 0.05% päevas');

    doc.moveDown(2);
    doc.fontSize(9)
       .text('Benaks OÜ IBAN: EE832200221051880171');

    /* finish PDF ---------------------------------------------------------- */
    doc.end();
    await new Promise(r => stream.on('finish', r));

    /* -- Upload to Drive -------------------------------------------------- */
    const folderId = '13ZfoFPBlxuoA9FnHPXf86B-JmLDnLOaO';
    const auth  = new google.auth.JWT(
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
        parents: [folderId],
        description: JSON.stringify({ invoiceNr: arve_nr, name: saaja_nimi, email })
      },
      media: { mimeType: 'application/pdf', body: fs.createReadStream(filePath) }
    });

    /* -- Send email ------------------------------------------------------- */
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
