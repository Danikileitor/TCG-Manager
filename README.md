# 🃏 TCG Manager
[![GitHub license](https://img.shields.io/github/license/Danikileitor/TCG-Manager.png)](https://github.com/Danikileitor/TCG-Manager/blob/main/LICENSE)

**TCG Manager** is an all-in-one collection tracker and deck builder designed for players of multiple Trading Card Games. Organize your binders, track your inventory, and build competitive or casual decks across different games in a single platform.

---

## ✨ Features

* **Multi-Game Support:** Manage collections and decks for multiple TCGs (e.g., *Magic: The Gathering, Pokémon, Yu-Gi-Oh!, Lorcana, One Piece*, etc.) in one place.
* **Collection Inventory:** Keep a detailed track of your cards, including quantities, sets, rarities, and conditions.
* **Intuitive Deck Builder:** Create, edit, and organize your decks with real-time card search and filtering.
* **Deck Statistics & Analytics:** View mana/cost curves, card type distributions, and deck legality at a glance. *(Remove if not applicable)*
* **Import & Export:** Easily import or export decklists in standard text formats. *(Remove if not applicable)*

---

## 🛠️ Tech Stack

* **Frontend:** [e.g., React, Next.js, Vue, Tailwind CSS]
* **Backend:** [e.g., Node.js, Express, Python, Django, Supabase]
* **Database:** [e.g., PostgreSQL, MongoDB, Firebase]
* **APIs:** [e.g., Scryfall API, Pokémon TCG API, YGOPRODeck API]

---

## 🚀 Getting Started

Follow these steps to set up the project locally on your machine.

### Prerequisites

Make sure you have the following installed:
* [Node.js](https://nodejs.org) (v18 or higher)
* [npm](https://npmjs.com) or [yarn](https://yarnpkg.com)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com[your-username]/tcg-manager.git
   cd tcg-manager
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   Create a `.env` file in the root directory and add the required keys:
   ```env
   DATABASE_URL=your_database_url
   API_KEY=your_api_key
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`.

---

## 📸 Screenshots

![Collection View](path/to/collection-screenshot.png)
![Deck Builder](path/to/deckbuilder-screenshot.png)

---

## 🗺️ Roadmap

- [ ] Add price tracking integration
- [ ] Implement user authentication & cloud sync
- [ ] Add mobile responsive view / PWA support
- [ ] Support for additional Trading Card Games

---

## 🤝 Contributing

Contributions are welcome! If you have suggestions or want to improve the app, feel free to fork the repository and submit a pull request.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the GNU General Public License v3.0 (GPLv3). See `LICENSE` for more information.
