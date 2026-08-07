export type Label = string | { name: string };

export type Issue = {
  index: number;
  title: string;
  updated_at: string;
  last_comment_at?: string;
  labels: Label[];
  assignees: string[];
  html_url: string;
};

