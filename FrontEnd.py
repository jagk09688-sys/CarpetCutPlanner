import streamlit as st

st.set_page_config(page_title="Carpet Measurement App", layout="wide")

st.title("🧶 Carpet Measurement App")

# Sidebar for room input
st.sidebar.header("Add Room Dimensions")
room_name = st.sidebar.text_input("Room Name")
length = st.sidebar.number_input("Length (m)", min_value=0.0, step=0.1)
width = st.sidebar.number_input("Width (m)", min_value=0.0, step=0.1)

if st.sidebar.button("Add Room"):
    if "rooms" not in st.session_state:
        st.session_state.rooms = []
    st.session_state.rooms.append({
        "name": room_name,
        "length": length,
        "width": width,
        "area": length * width
    })

# Display room list
st.subheader("📋 Room List")
if "rooms" in st.session_state:
    for i, room in enumerate(st.session_state.rooms):
        st.write(f"**{room['name']}**: {room['length']}m × {room['width']}m = {room['area']} m²")

    total_area = sum(r["area"] for r in st.session_state.rooms)
    st.success(f"**Total Carpet Area:** {total_area:.2f} m²")

    # Basic cost estimate
    cost_per_m2 = st.number_input("Cost per m² ($)", min_value=0.0, value=25.0)
    total_cost = total_area * cost_per_m2
    st.info(f"**Estimated Cost:** ${total_cost:.2f}")

else:
    st.warning("No rooms added yet.")
st.sidebar.header("Roll Settings")
roll_width = st.sidebar.number_input("Roll Width (m)", min_value=1.0, value=3.66, step=0.01)