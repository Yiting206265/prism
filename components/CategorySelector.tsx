'use client';

interface Category {
  code: string;
  label: string;
}

interface CategoryGroup {
  label: string;
  categories: Category[];
}

const GROUPS: CategoryGroup[] = [
  {
    label: 'AI & ML',
    categories: [
      { code: 'cs.AI',  label: 'cs.AI'  },
      { code: 'cs.LG',  label: 'cs.LG'  },
      { code: 'cs.CV',  label: 'cs.CV'  },
      { code: 'cs.CL',  label: 'cs.CL'  },
      { code: 'cs.RO',  label: 'cs.RO'  },
      { code: 'cs.NE',  label: 'cs.NE'  },
      { code: 'cs.IR',  label: 'cs.IR'  },
      { code: 'stat.ML', label: 'stat.ML' },
    ],
  },
  {
    label: 'Physics',
    categories: [
      { code: 'quant-ph',   label: 'quant-ph'   },
      { code: 'cond-mat',   label: 'cond-mat'   },
      { code: 'hep-th',     label: 'hep-th'     },
      { code: 'astro-ph',   label: 'astro-ph'   },
      { code: 'physics.optics', label: 'optics' },
    ],
  },
  {
    label: 'Biology',
    categories: [
      { code: 'q-bio.NC', label: 'q-bio.NC' },
      { code: 'q-bio.GN', label: 'q-bio.GN' },
      { code: 'q-bio.BM', label: 'q-bio.BM' },
      { code: 'q-bio.QM', label: 'q-bio.QM' },
    ],
  },
  {
    label: 'Math',
    categories: [
      { code: 'math.ST', label: 'math.ST' },
      { code: 'math.OC', label: 'math.OC' },
      { code: 'math.CO', label: 'math.CO' },
      { code: 'math.PR', label: 'math.PR' },
    ],
  },
  {
    label: 'Finance',
    categories: [
      { code: 'q-fin.TR', label: 'q-fin.TR' },
      { code: 'q-fin.PM', label: 'q-fin.PM' },
      { code: 'q-fin.RM', label: 'q-fin.RM' },
    ],
  },
];

interface Props {
  selected: string;
  onChange: (category: string) => void;
}

export default function CategorySelector({ selected, onChange }: Props) {
  return (
    <div className="category-section">
      <div className="category-inner">
        {GROUPS.map((group) => (
          <div key={group.label} className="category-group">
            <span className="category-group-label">{group.label}</span>
            <div className="category-pills">
              {group.categories.map((cat) => (
                <button
                  key={cat.code}
                  className={`category-pill${selected === cat.code ? ' active' : ''}`}
                  onClick={() => onChange(cat.code)}
                  title={cat.code}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
