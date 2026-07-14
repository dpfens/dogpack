import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Fdog } from './fdog';

describe('Fdog', () => {
  let component: Fdog;
  let fixture: ComponentFixture<Fdog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Fdog],
    }).compileComponents();

    fixture = TestBed.createComponent(Fdog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
