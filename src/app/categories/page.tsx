import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listRules } from "../../db/repositories/rules";
import { addCategory, createRule } from "./actions";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const database = db();
  const categories = listCategories(database);
  const rules = listRules(database);

  return (
    <div>
      <div className="card">
        <h2>Catégories</h2>
        <ul>{categories.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
        <form action={addCategory} style={{ display: "flex", gap: ".5rem" }}>
          <input name="name" placeholder="Nouvelle catégorie" />
          <button type="submit">Ajouter</button>
        </form>
      </div>

      <div className="card">
        <h2>Règles de catégorisation</h2>
        <table>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th></tr></thead>
          <tbody>{rules.map((r, i) => <tr key={i}><td>{r.keyword}</td><td>{r.category}</td></tr>)}</tbody>
        </table>
        <form action={createRule} style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
          <input name="keyword" placeholder="Mot-clé (ex. DECATHLON)" />
          <select name="category" defaultValue="">
            <option value="" disabled>Catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <button type="submit">Ajouter la règle</button>
        </form>
      </div>
    </div>
  );
}
