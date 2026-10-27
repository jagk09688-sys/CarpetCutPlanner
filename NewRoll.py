from flask import Flask, render_template_string, request
import math

app = Flask(__name__)

CARPET_WIDTH = 3.66
WASTAGE_FACTOR = 0.1
REUSABLE_WIDTH_THRESHOLD = 3.33  # Widths ≤ this can reuse leftover strips

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
        <li>
          <strong>{{ r['room'] }}</strong>: {{ r['area'] }} m²
          ({{ r['length'] }}m × {{ r['width'] }}m)
          {% if r['joins'] > 0 %}<br>🔗 Joins: {{ r['joins'] }}{% endif %}
          {% if r['wastage'] %}<br>🗑️ Wastage added{% endif %}
          {% if r['reused'] %}<br>♻️ Reused leftover strip{% endif %}
          {% if r['notes'] %}<br>📝 Notes: {{ r['notes'] }}{% endif %}
        </li>
      {% endfor %}
    </ul>
    <h2>🧮 Total Carpet Area Required: {{ total_area }} m²</h2>

    <h3>📊 Summary</h3>
    <ul>
      <li>Total Joins Across All Rooms: {{ results | map(attribute='joins') | sum }}</li>
      <li>Total Rooms Reusing Leftover Strips: {{ results | selectattr('reused') | list | length }}</li>
    </ul>
  {% endif %}
</body>
</html>
"""

@app.route("/", methods=["GET", "POST"])
def carpet_calculator():
    results = []
    total_area = 0
    leftover_strips = []

    if request.method == "POST":
        room_keys = [key for key in request.form if "_name" in key]
        for key in room_keys:
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

            joins = 0
            wastage = False
            reused = False
            notes = []

            if floor_type == "soft":
                if width > CARPET_WIDTH:
                    strips = math.ceil(width / CARPET_WIDTH)
                    joins = strips - 1
                    effective_width = strips * CARPET_WIDTH
                    area = round(length * effective_width, 2)

                    leftover = effective_width - width
                    if leftover > 0:
                        leftover_strips.append(leftover)
                        notes.append(f"{joins} join(s) added. Leftover strip: {leftover:.2f}m")

                else:
                    reusable = next((s for s in leftover_strips if s >= width), None)
                    if reusable:
                        reused = True
                        leftover_strips.remove(reusable)
                        area = round(length * width, 2)
                        notes.append(f"Reused leftover strip of {reusable:.2f}m")
                    else:
                        wastage = True
                        area = round(length * CARPET_WIDTH * (1 + WASTAGE_FACTOR), 2)
                        leftover = CARPET_WIDTH - width
                        notes.append(f"New roll used. Room width < roll width. Wastage: {leftover:.2f}m (can be reused or discarded)")

            elif floor_type == "hard":
                area = round(length * width, 2)
                notes.append("Hard floor: exact area used, no joins or wastage")

            else:
                continue

            results.append({
                "room": name,
                "length": length,
                "width": width,
                "area": area,
                "joins": joins,
                "wastage": wastage,
                "reused": reused,
                "notes": "; ".join(notes)
            })
            total_area += area

        total_area = round(total_area, 2)

    return render_template_string(template, results=results if results else None, total_area=total_area if results else None)

if __name__ == "__main__":
    app.run(debug=True)