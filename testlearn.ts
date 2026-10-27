<form id="dimensionForm">
  <input type="number" id="length" placeholder="Enter length" required />
  <input type="number" id="width" placeholder="Enter width" required />
  <button type="submit">Submit</button>
</form>
document.getElementById('dimensionForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const length = parseFloat(document.getElementById('length').value);
  const width = parseFloat(document.getElementById('width').value);

  const response = await fetch('/api/insertDimensions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ length, width })
  });

  const result = await response.json();
  console.log(result.message);
});
app.post('/api/insertDimensions', (req, res) => {
  const { length, width } = req.body;
  if (!length || !width) {
    return res.status(400).json({ message: 'Length and width are required.' });
  }

  // Insert into database or process here
  console.log(`Received: Length=${length}, Width=${width}`);
  res.json({ message: 'Dimensions inserted successfully!' });
});