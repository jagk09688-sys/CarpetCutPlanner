from flask import Flask, render_template_string, request
import math

app = Flask(__name__)

CARPET_WIDTH = 3.66
WASTAGE_FACTOR = 0.1  # 10% extra for narrow rooms

template = """
<!doctype html>
<html>
<head>
  <title>Carpet Measurement Tool</title>
  <script>
    let roomCount = 0;
    function addRoom() {
      roomCount++;
      const container = document.getElementById("room-container");
      const roomDiv = document.createElement("div");
      roomDiv.innerHTML = `
        <h3>Room ${roomCount}</h3>
        <label>Name:</label>
        <input type="text" name="room${roomCount}_name" required><br>
        <label>Floor Type (soft/hard):</label>
        <input type="text" name="room${roomCount}_type" required><br>
        <label>Length (m):</label>
        <input type="number" step="0.01" name="room${roomCount}_length" required><br>
        <label>Width (m):</label>
        <input type="number" step="0.01" name="room${roomCount}_width" required><br><br>
      `;
      container.appendChild(roomDiv);
    }
  </script>
</head>
<body>
  <h2>🧵 Carpet Area Calculator</h2>
  <form method="post">
    <div id="room-container"></div>
    <button type="button" onclick="addRoom()">➕ Add Room</button><br><br>
    <input type="submit" value="Calculate Total Carpet Area">
  </form>

  {% if results %}
    <h3>🧮 Room-wise Carpet Calculation</h3>
    <ul>
      {% for r in results %}
        <li><strong>{{ r['room'] }}</strong>: {{ r['area'] }} m²
          {% if r['joins'] is not none %}(Joins: {{ r['joins'] }}){% endif %}
          {% if r['wastage'] %}(Wastage added){% endif %}
        </li>
      {% endfor %}
    </ul>
    <h2>🧮 Total Carpet Area Required: {{ total_area }} m²</h2>
  {% endif %}
</body>
</html>
"""

@app.route("/", methods=["GET", "POST"])
def carpet_calculator():
    results = []
    total_area = 0

    if request.method == "POST":
        for key in request.form:
            if "_name" in key:
                prefix = key.split("_name")[0]
                name = request.form.get(f"{prefix}_name")
                floor_type = request.form.get(f"{prefix}_type", "").lower()
                try:
                    length = float(request.form.get(f"{prefix}_length", 0))
                    width = float(request.form.get(f"{prefix}_width", 0))
                except ValueError:
                    continue

                if not name or not floor_type or length <= 0 or width <= 0:
                    continue

                joins = None
                wastage = False

                if floor_type == "soft":
                    if width > CARPET_WIDTH:
                        strips = math.ceil(width / CARPET_WIDTH)
                        joins = strips - 1
                        effective_width = strips * CARPET_WIDTH
                        area = round(length * effective_width, 2)
                    else:
                        wastage = True
                        area = round(length * CARPET_WIDTH * (1 + WASTAGE_FACTOR), 2)
                elif floor_type == "hard":
                    area = round(length * width, 2)
                else:
                    continue  # skip unknown floor types

                results.append({
                    "room": name,
                    "area": area,
                    "joins": joins,
                    "wastage": wastage
                })
                total_area += area

        total_area = round(total_area, 2)

    return render_template_string(template, results=results if results else None, total_area=total_area if results else None)

if __name__ == "__main__":
    app.run(debug=True)