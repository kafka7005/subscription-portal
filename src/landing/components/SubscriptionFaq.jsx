import { useState } from 'react';

function FaqItem({ question, answer, index }) {
  const [open, setOpen] = useState(false);
  const questionId = `faq-question-${index}`;
  const answerId = `faq-answer-${index}`;
  return <div className="subscription-faq-item" data-open={open}>
    <h3><button className="faq-question" id={questionId} type="button" aria-expanded={open}
      aria-controls={answerId} onClick={() => setOpen(!open)}>
      <span>{question}</span>
      <span className="faq-icon" aria-hidden="true">
        <span className="faq-plus">+</span>
        <span className="faq-minus">−</span>
      </span>
    </button></h3>
    <div className="faq-answer" id={answerId} role="region" aria-labelledby={questionId} inert={!open}>
      <div className="faq-answer-clip"><p>{answer}</p></div>
    </div>
  </div>;
}

export default function SubscriptionFaq({ copy }) {
  return <section className="subscription-faq" id="faq" aria-labelledby="faq-title">
    <h2 id="faq-title"><span>{copy.faqTitle[0]}</span>{' '}<span>{copy.faqTitle[1]}</span></h2>
    <div className="subscription-faq-list">
      {copy.subscriptionFaq.map(([question, answer], index) => <FaqItem key={index} question={question} answer={answer} index={index} />)}
    </div>
  </section>;
}
