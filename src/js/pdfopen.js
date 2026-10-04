// pdfopen.js — opens a PDF document, asking for a password only when the file needs one (Decision 125).
// pdfjs is passed in so this runs under Node tests as well as in the app. The password lives only in
// the callback's closure and pdf.js's worker for the life of the open document; it is never stored.

// askPassword(wasWrong) -> Promise<string | null>; null means the person gave up.
async function openPdfDocument(pdfjs, bytes, askPassword) {
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false });
  let gaveUp = false;
  task.onPassword = async (update, reason) => {
    let pw = null;
    try { pw = await askPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD); } catch { pw = null; }
    if (pw === null || pw === undefined) { gaveUp = true; task.destroy().catch(() => {}); return; }
    update(pw);
  };
  try {
    return await task.promise;
  } catch (err) {
    if (gaveUp) throw Object.assign(new Error('A password is needed to open this PDF.'), { name: 'PasswordException' });
    throw err;
  }
}

export { openPdfDocument };
