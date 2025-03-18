const { google } = require('googleapis');

exports.handler = async () => {
  try {
    // 1) Auth with Google
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    const drive = google.drive({ version: 'v3', auth });

    // 2) Limit to your Invoices folder
    const folderId = '11-WG0xQwc21r_yTuBQXD-IiBNMwf8fXp';
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/pdf'`,
      fields: 'files(id, name, webViewLink)'
    });

    const files = res.data.files || [];

    return {
      statusCode: 200,
      body: JSON.stringify(files)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
