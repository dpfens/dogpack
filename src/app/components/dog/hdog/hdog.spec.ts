import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Hdog } from './hdog';

describe('Hdog', () => {
  let component: Hdog;
  let fixture: ComponentFixture<Hdog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Hdog],
    }).compileComponents();

    fixture = TestBed.createComponent(Hdog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
